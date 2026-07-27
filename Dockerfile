# Stage 1: Install Node.js dependencies with build tools
FROM node:22-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY wisp-js/ ./wisp-js/

RUN npm ci --omit=dev

# Stage 2: Minimal Runtime Container
FROM node:22-slim
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY wisp-js/ ./wisp-js/
COPY src/ ./src/

COPY browser.js/packages/chrome/dist /app/dist/chrome
COPY browser.js/packages/sandbox /app/dist/sandbox
COPY dist/firefox /app/dist/firefox

ENV PORT=8080
ENV HOST=0.0.0.0
ENV STATIC_DIR=/app/dist/chrome
ENV SANDBOX_DIR=/app/dist/sandbox
ENV FIREFOX_DIR=/app/dist/firefox

EXPOSE 8080

CMD ["node", "src/server.js"]
