# Stage 1: Build React frontend
FROM oven/bun:1-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN bun install
COPY frontend/ ./
RUN bun run build

# Stage 2: Build Go backend
FROM golang:1.24-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN CGO_ENABLED=0 GOOS=linux go build -o /cineforge .

# Stage 3: Minimal runtime
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata ffmpeg su-exec shadow
WORKDIR /app
COPY --from=backend-builder /cineforge .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh && mkdir -p /data

LABEL org.opencontainers.image.description="Radarr/Sonarr companion utility for library browsing, bulk import, and audio normalization"
LABEL org.opencontainers.image.licenses="MIT"

EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["./cineforge"]
