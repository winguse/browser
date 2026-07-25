# Stage 1: Build Rust Binary
FROM rust:1-slim-bookworm AS rust-builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src/ ./src/
COPY epoxy-tls/ ./epoxy-tls/
RUN cargo build --release

# Stage 2: Minimal Runtime Container
FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=rust-builder /app/target/release/browser-server /app/browser-server
COPY browser.js/packages/chrome/dist /app/dist/chrome
COPY browser.js/packages/sandbox /app/dist/sandbox

ENV PORT=8080
ENV HOST=0.0.0.0
ENV STATIC_DIR=/app/dist/chrome
ENV SANDBOX_DIR=/app/dist/sandbox

EXPOSE 8080

CMD ["/app/browser-server"]
