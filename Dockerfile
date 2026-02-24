# Stage 1: Build React frontend
FROM oven/bun:1-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN bun install
COPY frontend/ ./
RUN bun run build

# Stage 2: Build Go backend
FROM golang:1.22-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN CGO_ENABLED=0 GOOS=linux go build -o /cineforge .

# Stage 3: Minimal runtime
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata ffmpeg
WORKDIR /app
COPY --from=backend-builder /cineforge .
RUN mkdir -p /data
EXPOSE 8080
CMD ["./cineforge"]
