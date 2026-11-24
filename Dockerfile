# syntax=docker/dockerfile:1.7

# Stage 1: Build Frontend SPA natively on BUILDPLATFORM
FROM --platform=$BUILDPLATFORM node:22-alpine AS web-builder
WORKDIR /src/web
RUN npm install -g pnpm@12.15.0
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# Stage 2: Cross-compile pure-Go binary with embedded SPA (zero QEMU overhead)
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS go-builder
ARG TARGETOS=linux
ARG TARGETARCH
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY --from=web-builder /src/web/dist ./internal/webui/dist
RUN mkdir -p /data /app/logs && \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" \
    -o /out/instabox-monitor ./cmd/server

# Stage 3: Minimal non-root multi-arch runtime (~20MB, linux/amd64 & linux/arm64)
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=go-builder /out/instabox-monitor /app/instabox-monitor
COPY --from=go-builder --chown=65532:65532 /data /data
COPY --from=go-builder --chown=65532:65532 /app/logs /app/logs
ENV PORT=8080 \
    APP_ENV=production \
    DATA_DIR=/data \
    LOG_DIR=/app/logs \
    TZ=UTC
EXPOSE 8080
VOLUME ["/data", "/app/logs"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/instabox-monitor", "-healthcheck"]
ENTRYPOINT ["/app/instabox-monitor"]
