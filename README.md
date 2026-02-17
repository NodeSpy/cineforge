# Radarr Importer

A disposable utility for bulk-importing hard-to-find classic animated shorts into [Radarr](https://radarr.video/). Built for one-off use when you need to add hundreds or thousands of entries that are tedious to search for manually — think vintage Looney Tunes, classic Disney shorts, Merrie Melodies, Silly Symphonies, and similar golden-age animation.

## Why This Exists

Radarr is great for managing a movie library, but adding large collections of pre-1960s animated shorts one at a time is painful. Many of these titles don't surface easily in Radarr's built-in search, and manually adding 1,000+ entries isn't realistic. This tool bridges that gap: point it at a JSON file, let it do the lookups, review the matches, and import them all at once.

**This is not meant to run permanently.** Spin it up, do your import, tear it down.

## Features

- **Import by ID** — Upload a JSON file containing TMDb or IMDb IDs and import them directly into Radarr.
- **Convert & Import** — Upload a JSON file with title/year data (e.g. scraped filmography lists), automatically look up each title on TMDb, review the matches, then import. Handles rate limiting and can resume interrupted sessions.
- **Duplicate Detection** — Skips movies already in your Radarr library.
- **Tag Support** — Apply a Radarr tag to all imported items for easy filtering.
- **Persistent Sessions** — Conversion matching progress is saved to SQLite, so you can close the browser and come back later.
- **Encrypted Secrets** — API keys are stored with AES-256-GCM encryption at rest.

## Quick Start

```bash
docker compose up -d --build
```

The UI will be available at [http://localhost:8085](http://localhost:8085).

1. Go to **Settings** and enter your Radarr URL, Radarr API key, and TMDb API key (get one at [themoviedb.org](https://www.themoviedb.org/settings/api)).
2. Select a quality profile and root folder, then save.
3. Use **Import** (if you already have TMDb/IMDb IDs) or **Convert** (if you have title/year JSON data).
4. Review the matches, apply a tag if desired, and import.

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

## Cleanup

When you're done importing:

```bash
docker compose down -v
```

The `-v` flag removes the data volume. There's nothing here you need to keep running.

## Stack

- **Backend**: Go (Chi router, modernc.org/sqlite)
- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **Infrastructure**: Single Docker container via Docker Compose
