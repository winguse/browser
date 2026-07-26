use std::{
	convert::Infallible,
	path::{Path, PathBuf},
	sync::Arc,
	time::SystemTime,
};

use anyhow::Context;
use bytes::Bytes;
use http_body_util::{combinators::BoxBody, BodyExt, Empty, Full};
use hyper::{
	body::Incoming, server::conn::http1::Builder, service::service_fn, upgrade::OnUpgrade, Method, Request, Response,
	StatusCode,
};
use hyper_util::rt::TokioIo;
use log::{error, info, trace};
use mime_guess::from_path;
use tokio::{fs::File, io::AsyncReadExt, net::TcpListener, net::TcpStream};
use tokio_util::compat::{FuturesAsyncReadCompatExt, FuturesAsyncWriteCompatExt};
use tokio_websockets::Limits;
use wisp_mux::{
	packet::{CloseReason, ConnectPacket, StreamType},
	stream::MuxStream,
	ws::{TokioWebsocketsTransport, TransportExt, TransportWrite},
	ServerMux,
};

type ResponseBody = BoxBody<Bytes, anyhow::Error>;

const CACHE_30_DAYS: &str = "public, max-age=2592000";

fn empty_body() -> ResponseBody {
	Empty::<Bytes>::new()
		.map_err(|e| match e {})
		.boxed()
}

fn full_body<T: Into<Bytes>>(chunk: T) -> ResponseBody {
	Full::new(chunk.into())
		.map_err(|e| anyhow::anyhow!(e))
		.boxed()
}

fn add_cors_headers<T>(mut resp: Response<T>) -> Response<T> {
	let headers = resp.headers_mut();
	headers.insert(hyper::header::ACCESS_CONTROL_ALLOW_ORIGIN, hyper::header::HeaderValue::from_static("*"));
	headers.insert(
		hyper::header::ACCESS_CONTROL_ALLOW_METHODS,
		hyper::header::HeaderValue::from_static("GET, POST, OPTIONS, HEAD, PUT, DELETE"),
	);
	headers.insert(hyper::header::ACCESS_CONTROL_ALLOW_HEADERS, hyper::header::HeaderValue::from_static("*"));
	headers.insert(
		hyper::header::HeaderName::from_static("cross-origin-resource-policy"),
		hyper::header::HeaderValue::from_static("cross-origin"),
	);
	headers.insert(
		hyper::header::HeaderName::from_static("cross-origin-opener-policy"),
		hyper::header::HeaderValue::from_static("same-origin"),
	);
	headers.insert(
		hyper::header::HeaderName::from_static("cross-origin-embedder-policy"),
		hyper::header::HeaderValue::from_static("require-corp"),
	);
	headers.insert(
		hyper::header::CONTENT_SECURITY_POLICY,
		hyper::header::HeaderValue::from_static("default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws: wss:;"),
	);
	resp
}

struct AppState {
	static_dir: PathBuf,
	sandbox_dir: PathBuf,
	firefox_dir: PathBuf,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
	env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

	let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
	let port: u16 = std::env::var("PORT")
		.unwrap_or_else(|_| "8080".to_string())
		.parse()
		.context("Invalid PORT")?;

	let static_dir = PathBuf::from(
		std::env::var("STATIC_DIR").unwrap_or_else(|_| "./browser.js/packages/chrome/dist".to_string()),
	);
	let sandbox_dir = PathBuf::from(
		std::env::var("SANDBOX_DIR").unwrap_or_else(|_| "./browser.js/packages/sandbox".to_string()),
	);
	let firefox_dir = PathBuf::from(
		std::env::var("FIREFOX_DIR").unwrap_or_else(|_| "./dist/firefox".to_string()),
	);

	let state = Arc::new(AppState {
		static_dir,
		sandbox_dir,
		firefox_dir,
	});

	let addr = format!("{}:{}", host, port);
	let listener = TcpListener::bind(&addr).await?;
	info!("Browser & Wisp Server listening on http://{}", addr);

	loop {
		let (stream, remote_addr) = match listener.accept().await {
			Ok(val) => val,
			Err(err) => {
				error!("Accept error: {:?}", err);
				continue;
			}
		};

		let state = state.clone();
		tokio::spawn(async move {
			let io = TokioIo::new(stream);
			let service = service_fn(move |req| {
				let state = state.clone();
				async move { handle_request(req, state).await }
			});

			if let Err(err) = Builder::new().serve_connection(io, service).with_upgrades().await {
				trace!("Connection error from {}: {:?}", remote_addr, err);
			}
		});
	}
}

async fn handle_request(
	mut req: Request<Incoming>,
	state: Arc<AppState>,
) -> Result<Response<ResponseBody>, Infallible> {
	// Handle CORS OPTIONS preflight
	if req.method() == Method::OPTIONS {
		let resp = Response::builder()
			.status(StatusCode::NO_CONTENT)
			.body(empty_body())
			.unwrap();
		return Ok(add_cors_headers(resp));
	}

	if is_upgrade_request(&req) {
		match handle_websocket_upgrade(&mut req) {
			Ok(resp) => return Ok(add_cors_headers(resp)),
			Err(err) => {
				error!("WebSocket upgrade error: {:?}", err);
				let resp = Response::builder()
					.status(StatusCode::BAD_REQUEST)
					.body(full_body("Bad Upgrade Request"))
					.unwrap();
				return Ok(add_cors_headers(resp));
			}
		}
	}

	let resp = serve_static_file(&req, &state).await;
	Ok(add_cors_headers(resp))
}

fn is_upgrade_request(req: &Request<Incoming>) -> bool {
	let headers = req.headers();
	headers
		.get(hyper::header::UPGRADE)
		.and_then(|v| v.to_str().ok())
		.map(|v| v.eq_ignore_ascii_case("websocket"))
		.unwrap_or(false)
}

fn handle_websocket_upgrade(req: &mut Request<Incoming>) -> anyhow::Result<Response<ResponseBody>> {
	let mut resp = Response::builder()
		.status(StatusCode::SWITCHING_PROTOCOLS)
		.header(hyper::header::UPGRADE, "websocket")
		.header(hyper::header::CONNECTION, "Upgrade");

	if let Some(sec_key) = req.headers().get("Sec-WebSocket-Key") {
		let sec_key_str = sec_key.to_str().unwrap_or_default();
		let accept_val = derive_accept_key(sec_key_str);
		resp = resp.header("Sec-WebSocket-Accept", accept_val);
	}

	if let Some(protocol) = req.headers().get("Sec-WebSocket-Protocol") {
		resp = resp.header("Sec-WebSocket-Protocol", protocol.clone());
	}

	let on_upgrade = hyper::upgrade::on(req);

	tokio::spawn(async move {
		if let Err(err) = process_wisp_connection(on_upgrade).await {
			error!("Wisp processing error: {:?}", err);
		}
	});

	Ok(resp.body(empty_body())?)
}

fn derive_accept_key(key: &str) -> String {
	use sha1::Digest;
	let mut hasher = sha1::Sha1::new();
	hasher.update(key.as_bytes());
	hasher.update(b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
	base64::Engine::encode(&base64::engine::general_purpose::STANDARD, hasher.finalize())
}

async fn process_wisp_connection(fut: OnUpgrade) -> anyhow::Result<()> {
	let upgraded = fut.await.context("Failed to await upgrade future")?;
	let io = TokioIo::new(upgraded);

	let ws = tokio_websockets::ServerBuilder::new()
		.limits(Limits::default())
		.serve(io);

	let transport = TokioWebsocketsTransport(ws);
	let (read, write) = transport.split_fast();

	let mux_res = ServerMux::new(read, write, 128, None).await?;
	let (mux, fut) = mux_res.with_no_required_extensions();
	let mux = Arc::new(mux);

	tokio::spawn(fut);

	while let Some((connect, stream)) = mux.wait_for_stream().await {
		tokio::spawn(handle_wisp_stream(connect, stream));
	}

	Ok(())
}

async fn handle_wisp_stream<W>(connect: ConnectPacket, muxstream: MuxStream<W>)
where
	W: TransportWrite + Unpin + Send + 'static,
{
	match connect.stream_type {
		StreamType::Tcp => {
			let addr = format!("{}:{}", connect.host, connect.port);
			match TcpStream::connect(&addr).await {
				Ok(tcp) => {
					let (muxrx, muxtx) = muxstream.into_async_rw().into_split();
					let mut muxrx = muxrx.compat();
					let mut muxtx = muxtx.compat_write();
					let (mut tcprx, mut tcptx) = tcp.into_split();

					let _ = tokio::select! {
						res = tokio::io::copy(&mut muxrx, &mut tcptx) => res,
						res = tokio::io::copy(&mut tcprx, &mut muxtx) => res,
					};
				}
				Err(_) => {
					let _ = muxstream.close(CloseReason::ServerStreamUnreachable).await;
				}
			}
		}
		_ => {
			let _ = muxstream.close(CloseReason::ServerStreamInvalidInfo).await;
		}
	}
}

async fn serve_static_file(req: &Request<Incoming>, state: &AppState) -> Response<ResponseBody> {
	let raw_path = req.uri().path();

	let (base_dir, relative_path) = if let Some(stripped) = raw_path.strip_prefix("/ff/") {
		(&state.firefox_dir, stripped)
	} else if raw_path == "/ff" || raw_path == "/ff/" {
		(&state.firefox_dir, "")
	} else if let Some(stripped) = raw_path.strip_prefix("/sandbox/") {
		(&state.sandbox_dir, stripped)
	} else if raw_path == "/sandbox" || raw_path == "/sandbox/" {
		(&state.sandbox_dir, "controller.html")
	} else if raw_path == "/controller.html" || raw_path == "/controller.sw.js" || raw_path == "/sw.js" {
		(&state.sandbox_dir, raw_path.trim_start_matches('/'))
	} else {
		(&state.static_dir, raw_path.trim_start_matches('/'))
	};

	let target_path = if relative_path.is_empty() {
		base_dir.join("index.html")
	} else {
		base_dir.join(relative_path)
	};

	if let Ok(resp) = try_serve_file(req, &target_path).await {
		return resp;
	}

	// Fallback to index.html for SPA routing if path doesn't have an extension
	if !relative_path.contains('.') {
		let fallback_path = base_dir.join("index.html");
		if let Ok(resp) = try_serve_file(req, &fallback_path).await {
			return resp;
		}
	}

	Response::builder()
		.status(StatusCode::NOT_FOUND)
		.body(full_body("404 Not Found"))
		.unwrap()
}

async fn try_serve_file(req: &Request<Incoming>, path: &Path) -> anyhow::Result<Response<ResponseBody>> {
	let mut file = File::open(path).await?;
	let metadata = file.metadata().await?;

	let modified_time = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
	let duration = modified_time.duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default();
	let modified_secs = duration.as_secs();

	let etag = format!("\"{:x}-{:x}\"", metadata.len(), modified_secs);
	let http_date = format_http_date(modified_time);

	// Check If-None-Match header for ETag validation
	if let Some(if_none_match) = req.headers().get(hyper::header::IF_NONE_MATCH) {
		if let Ok(str_val) = if_none_match.to_str() {
			if str_val.trim() == etag || str_val.contains(&etag) {
				return Ok(Response::builder()
					.status(StatusCode::NOT_MODIFIED)
					.header(hyper::header::CACHE_CONTROL, CACHE_30_DAYS)
					.header(hyper::header::ETAG, etag)
					.header(hyper::header::LAST_MODIFIED, http_date)
					.body(empty_body())?);
			}
		}
	}

	// Check If-Modified-Since header
	if let Some(if_mod_since) = req.headers().get(hyper::header::IF_MODIFIED_SINCE) {
		if let Ok(str_val) = if_mod_since.to_str() {
			if str_val.trim() == http_date {
				return Ok(Response::builder()
					.status(StatusCode::NOT_MODIFIED)
					.header(hyper::header::CACHE_CONTROL, CACHE_30_DAYS)
					.header(hyper::header::ETAG, etag)
					.header(hyper::header::LAST_MODIFIED, http_date)
					.body(empty_body())?);
			}
		}
	}

	let mut contents = Vec::with_capacity(metadata.len() as usize);
	file.read_to_end(&mut contents).await?;

	let mime = from_path(path).first_or_octet_stream();

	let resp = Response::builder()
		.status(StatusCode::OK)
		.header(hyper::header::CONTENT_TYPE, mime.as_ref())
		.header(hyper::header::CACHE_CONTROL, CACHE_30_DAYS)
		.header(hyper::header::ETAG, etag)
		.header(hyper::header::LAST_MODIFIED, http_date);

	Ok(resp.body(full_body(contents))?)
}

fn format_http_date(time: SystemTime) -> String {
	let secs = time.duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs();

	let days = (secs / 86400) as i64;
	let rem_secs = (secs % 86400) as u32;

	let hours = rem_secs / 3600;
	let mins = (rem_secs % 3600) / 60;
	let seconds = rem_secs % 60;

	let weekday = match (days + 4) % 7 {
		0 => "Sun",
		1 => "Mon",
		2 => "Tue",
		3 => "Wed",
		4 => "Thu",
		5 => "Fri",
		_ => "Sat",
	};

	let z = days + 719468;
	let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
	let doe = (z - era * 146097) as u32;
	let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
	let y = (yoe as i64) + era * 400;
	let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
	let mp = (5 * doy + 2) / 153;
	let d = doy - (153 * mp + 2) / 5 + 1;
	let m = if mp < 10 { mp + 3 } else { mp - 9 };
	let y = if m <= 2 { y + 1 } else { y };

	let month = match m {
		1 => "Jan",
		2 => "Feb",
		3 => "Mar",
		4 => "Apr",
		5 => "May",
		6 => "Jun",
		7 => "Jul",
		8 => "Aug",
		9 => "Sep",
		10 => "Oct",
		11 => "Nov",
		_ => "Dec",
	};

	format!("{}, {:02} {} {:04} {:02}:{:02}:{:02} GMT", weekday, d, month, y, hours, mins, seconds)
}
