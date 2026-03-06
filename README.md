# CineForge

A comprehensive [Radarr](https://radarr.video/) companion utility for browsing your library, bulk-importing movies, and normalizing audio across your media collection.

## Features

- **Library Browser** — Browse your entire Radarr library in a poster-card grid or table view. Filter by codec, resolution, audio format, HDR, genre, tags, and more. Cached locally in SQLite for fast repeat loads.
- **Import by ID** — Upload a JSON file containing TMDb or IMDb IDs and import them directly into Radarr with duplicate detection and tag support.
- **Convert & Import** — Upload a JSON file with title/year data, automatically look up each title on TMDb, review and select matches, then import. Handles rate limiting and can resume interrupted sessions.
- **Audio Normalization** — Two-pass ffmpeg loudnorm processing with real-time progress. Beginner-friendly LUFS presets (Streaming, Broadcast, Cinematic) with an advanced settings toggle for hardware acceleration, audio bitrate, video mode, and parallel jobs. Includes job history with Before/After LUFS display, retry for failed items, and LUFS compliance checks to skip files already at target.
- **Job History** — Track import and normalization history. Reconcile import results against Radarr to see which movies are present and which are still missing. Persisted across restarts.
- **Settings** — Configure Radarr and TMDb connections, import defaults, normalization settings, and manage data (clear history).
- **Encrypted Secrets** — API keys are stored with AES-256-GCM encryption at rest.

## Quick Start

```bash
docker compose up -d --build
```

The UI will be available at [http://localhost:8085](http://localhost:8085).

1. Go to **Settings** and enter your Radarr URL, Radarr API key, and TMDb API key (get one at [themoviedb.org](https://www.themoviedb.org/settings/api)).
2. Select a quality profile and root folder, then save.
3. Browse your library, import movies, or normalize audio from the sidebar navigation.

## Data directory

Data (SQLite DB, encrypted API keys) is stored at `/var/lib/cineforge` on the host (mounted as `/data` in the container). Create it with correct ownership if needed: `sudo mkdir -p /var/lib/cineforge && sudo chown 1000:1000 /var/lib/cineforge` (or your PUID/PGID). The entrypoint will chown `/data` at startup.

**Migrating from the old Docker named volume:** If you previously used the `cineforge-data` volume, stop the stack, create `/var/lib/cineforge`, then copy data: `docker run --rm -v cineforge-data:/from -v /var/lib/cineforge:/to alpine sh -c "cp -a /from/. /to/"`. Update to the new compose and start again.

## Media Volume

To use audio normalization, CineForge needs access to your media files. Copy `docker-compose.override.example.yml` to `docker-compose.override.yml` and configure your media volume mount:

```yaml
services:
  cineforge:
    volumes:
      - /path/to/your/movies:/media/movies
```

For VAAPI hardware acceleration, also pass through the DRI device:

```yaml
    devices:
      - /dev/dri:/dev/dri
```

## JSON Formats

**Import by ID** — array of objects with `tmdb_id` or `imdb_id`:

```json
[
  { "tmdb_id": 13061 },
  { "imdb_id": "tt0029852" }
]
```

**Convert** — array of objects with `title` and `year`:

```json
[
  { "title": "Porky's Hare Hunt", "year": "1938" },
  { "title": "A Wild Hare", "year": "1940" }
]
```

## Development

```bash
# Frontend (dev server on :5173)
cd frontend && npm install && npm run dev

# Backend (API on :8080)
cd backend && go run .
```

The Vite dev server proxies `/api` requests to the Go backend.

## Stack

- **Backend**: Go 1.22, Chi v5 router, modernc.org/sqlite (pure-Go, no CGo)
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Media Processing**: ffmpeg/ffprobe (included in container) with VAAPI/NVENC hardware acceleration support
- **Database**: SQLite with WAL mode, AES-256-GCM encrypted secrets
- **Infrastructure**: Multi-stage Docker build producing a single Alpine container
