# CineForge

A comprehensive Radarr companion utility providing:
- **Library Browser** -- Full Radarr library browsing with poster-card grid and list views, SQLite caching, rich client-side filtering (codec, resolution, audio, HDR, tags, quality, etc.)
- **Bulk Import** -- Import movies from JSON files with TMDb/IMDb IDs
- **Convert & Import** -- Match titles against TMDb and import to Radarr
- **Audio Normalization** -- Go-native two-pass ffmpeg loudnorm processing with real-time SSE progress, beginner-friendly preset UI with advanced settings toggle
- **Settings** -- Radarr/TMDb connection config and normalize settings

### Page Accent Colors
- **Library**: violet (`#8b5cf6`)
- **Import**: radarr gold (existing)
- **Convert**: blue (existing)
- **Normalize**: teal (`#14b8a6`)

---

## Architecture

Full-stack web application. Go backend (Chi router) serves an embedded React frontend. SQLite database for persistence.

- **Backend**: Go 1.22, Chi v5 router, `modernc.org/sqlite` (pure-Go, no CGo)
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Deployment**: Multi-stage Docker build → single Alpine container (with ffmpeg) on port 8085:8080
- **Database**: SQLite with WAL mode at `$DATA_DIR/cineforge.db` (default `/data/`); auto-migrates from `radarr-importer.db` if found
- **Secrets**: AES-256-GCM encryption for API keys stored in config table

---

## Backend

### `backend/`

Entry point and Go module root.

| File | Purpose |
|------|---------|
| `main.go` | Chi router setup, middleware (CORS, logger, recoverer, compress), route registration, embedded frontend serving via `//go:embed frontend/dist`. SSE endpoints (convert stream, normalize status) excluded from compression. |
| `go.mod` | Module `cineforge`, Go 1.22; deps: chi, cors, uuid, modernc sqlite |

### `backend/internal/db/`

Database initialization and schema migrations.

| File | Purpose |
|------|---------|
| `db.go` | `Init()` opens SQLite at `$DATA_DIR/cineforge.db` with WAL mode (auto-renames from `radarr-importer.db` for seamless upgrades). `migrate()` runs `CREATE TABLE IF NOT EXISTS` for all tables. `BackfillImportedMovies()` parses completed import job results to populate `imported_movies`. `RecoverStaleNormalizeJobs()` resets interrupted normalize jobs on startup. Exports: `DB` (global), `Init()`, `Close()` |

**Tables:**
- `config` — key-value store with optional AES encryption for secrets
- `jobs` — import job tracking with JSON results column; includes `reconciled_results` and `reconciled_at` for persisted Radarr reconciliation
- `conversion_sessions` — TMDb matching sessions with source JSON for resume
- `conversion_items` — per-item match results with TMDb ID selection
- `imported_movies` — denormalized lookup for movies imported via CineForge (tmdb_id, imdb_id, title, job_id)
- `normalize_jobs` — normalization session tracking (status, counters, config_snapshot)
- `normalize_items` — per-file normalization status (file_path, measured_lufs, target_lufs, status, error, progress_pct)
- `normalize_history` — persistent cache keyed by (file_path, file_size, file_mtime, target_lufs) to prevent re-processing
- `library_cache` — cached Radarr movie data as JSON per radarr_id, avoids re-fetching on every page load
- `library_cache_meta` — key-value store for library cache metadata (last_refreshed timestamp, tags_json, profiles_json)

### `backend/internal/config/`

Application configuration backed by the `config` table.

| File | Purpose |
|------|---------|
| `config.go` | `AppConfig` struct with Radarr/TMDb URLs, API keys, quality profile, root folder, import defaults. `Get()` reads from DB, `SetFields()` writes partial updates, `GetMasked()` returns secrets masked. AES-256-GCM encrypt/decrypt. `NormalizeConfig` struct and `GetNormalizeConfig()` for normalize settings. |

**Config keys:** `radarr_url`, `radarr_api_key`, `tmdb_api_key`, `quality_profile_id`, `root_folder_path`, `min_availability`, `search_on_add`, `monitored`, `normalize_target_lufs`, `normalize_hwaccel`, `normalize_audio_bitrate`, `normalize_backup`, `normalize_parallel`, `normalize_video_mode`

### `backend/internal/radarr/`

HTTP client for Radarr API v3.

| File | Purpose |
|------|---------|
| `client.go` | `Client` struct with `BaseURL`, `APIKey`, 30s timeout. Methods: `GetStatus`, `GetQualityProfiles`, `GetRootFolders`, `GetTags`, `CreateTag`, `LookupByTmdbID`, `LookupByImdbID`, `AddMovie`, `GetMovies`, `GetMovie(id)`, `GetMovieFiles(movieID)`. Types: `Movie` (expanded with Genres, Studio, Runtime, SizeOnDisk, Path, MovieFile, etc.), `MovieFile`, `MediaInfo`, `Quality`, `QualityDetail`, `Revision`, `Language`, `Image`, `AddOptions`, `Tag`, `QualityProfile`, `RootFolder`, `SystemStatus` |

`GET /api/v3/movie` returns all movies with nested `movieFile` + `mediaInfo` in a single call, used by both the Library browser and normalize candidate discovery.

### `backend/internal/tmdb/`

HTTP client for TMDb API with rate limiting.

| File | Purpose |
|------|---------|
| `client.go` | `Client` with 250ms base delay, retry on 429 with exponential backoff. `SearchMovie(query, year)` and `GetMovie(id)`. Types: `Movie`, `SearchResult`. `ThrottleCallback` for SSE progress |

### `backend/internal/normalize/`

Go-native FFmpeg normalization engine (ported from plex-scripts Python).

| File | Purpose |
|------|---------|
| `engine.go` | Two-pass loudnorm: `MeasureLoudness()` (pass 1 measure) → `NormalizeFile()` (pass 2 encode with `-progress pipe:1`). LUFS compliance check (0.5 LU tolerance) skips re-encode for already-compliant files. `buildNormalizeArgs()` constructs encoder-specific args. `-c:v copy` first attempt with automatic fallback to full re-encode. `RunJob()` with concurrent worker pool. `GetDuration()` via ffprobe. `HasAudioStream()` check. Atomic file replacement via temp file + `os.Rename`. Optional backup. Types: `NormalizeConfig`, `LoudnessInfo`, `FileProgress`, `FileResult` |
| `hwdetect.go` | `DetectHWAccel()` probes for VAAPI (`/dev/dri/renderD128`) → NVENC (`nvidia-smi`) → CPU fallback |

### `backend/internal/jobs/`

In-memory job manager with SQLite persistence.

| File | Purpose |
|------|---------|
| `manager.go` | `Job` struct with status (pending/running/completed/failed), counters, JSON `Results` array, `ReconciledResults`, `ReconciledAt`. `Create()`, `Get()`, `GetRecent()`. `Result` struct: `Title`, `TmdbID`, `ImdbID`, `Status`, `Error` |

### `backend/internal/conversions/`

Conversion session persistence for TMDb matching workflow.

| File | Purpose |
|------|---------|
| `conversions.go` | `Session` and `Item` types. CRUD operations: `CreateSession`, `AddItem`, `GetSession`, `ListSessions`, `ListAllSessions`, `UpdateSelection`, `MarkItemImported`, `DeleteImportedItems`, `DeleteSession`, `SetSessionJobID`, `SetSessionStatus`. Stores source JSON for SSE resume |

### `backend/internal/handlers/`

HTTP handlers for all API endpoints.

| File | Purpose |
|------|---------|
| `helpers.go` | `writeJSON()` helper, `isMasked()` check |
| `config.go` | `GetConfig`, `UpdateConfig`, `GetSecrets`, `ValidateConfig` |
| `import.go` | `PreviewImport` (lookup + duplicate check), `ImportMovies` (async via goroutine + job). Inserts into `imported_movies` on success. Links conversion sessions to jobs. |
| `convert.go` | `ConvertTitles` (sync), `ConvertTitlesStream` (SSE), `ResumeConvertStream`. TMDb matching with progress events |
| `conversions.go` | `ListConversions`, `ListConversionHistory`, `GetConversion`, `UpdateConversionSelection`, `DeleteConversion` |
| `jobs.go` | `GetJob`, `GetRecentJobs`, `ReconcileJob` (live Radarr cross-reference with persisted results) |
| `radarr_proxy.go` | `GetRadarrStatus`, `TestRadarrConnection`, `GetQualityProfiles`, `GetRootFolders`, `GetTags`, `CreateTag` |
| `tmdb_proxy.go` | `TestTMDbConnection` |
| `library.go` | `GetLibrary` — returns cached library from SQLite (auto-fetches from Radarr if cache empty). `RefreshLibrary` — forces fresh pull, repopulates `library_cache` + `library_cache_meta`. Computes `FilterOptions`. Response includes `cached_at` and `normalized_ids`. |
| `normalize.go` | `GetNormalizeCandidates`, `StartNormalize` (launches background job with goroutine worker pool), `StopNormalize`, `GetNormalizeStatus` (SSE stream with progress/items/done events), `GetNormalizeJobs` (paginated), `GetNormalizeJob` (with items detail), `RetryNormalize` (retries failed items, marks originals as 'retried'), `ClearNormalizeHistory`, `GetNormalizeConfigHandler`, `UpdateNormalizeConfig` |

### API Routes

**SSE endpoints (no compression):**
- `POST /api/convert/stream`
- `POST /api/convert/resume/{id}`
- `GET /api/normalize/status/{id}`

**Compressed API routes under `/api`:**
- Config: `GET/PUT /config`, `GET /config/secrets`, `POST /config/validate`
- Convert: `POST /convert`
- Conversions: `GET /conversions`, `GET /conversions/all`, `GET/DELETE /conversions/{id}`, `PUT /conversions/{id}/selection`
- Import: `POST /import/preview`, `POST /import`
- Radarr proxy: `GET /radarr/status`, `POST /radarr/test`, `POST /tmdb/test`, `GET /radarr/profiles`, `GET /radarr/rootfolders`, `GET/POST /radarr/tags`
- Jobs: `GET /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/reconcile`
- Library: `GET /library`, `POST /library/refresh`
- Normalize: `GET /normalize/candidates`, `POST /normalize/start`, `POST /normalize/stop/{id}`, `GET /normalize/jobs`, `GET /normalize/jobs/{id}`, `GET/PUT /normalize/config`, `POST /normalize/retry/{id}`, `DELETE /normalize/history`

---

## Frontend

### `frontend/`

React SPA with Vite build tooling.

| File | Purpose |
|------|---------|
| `package.json` | React 18, react-router-dom 6, Tailwind 3, Vite 5, Vitest 2. Name: `cineforge` |
| `vite.config.ts` | React plugin, Vitest config, `/api` proxy to `localhost:8080` |
| `tailwind.config.js` | Custom colors: `radarr` (gold/amber), `teal` (normalize accent), `violet` (library accent), `dark` (gray spectrum) |
| `index.html` | SPA shell with title "CineForge" |

### `frontend/src/`

| File | Purpose |
|------|---------|
| `main.tsx` | React entry, BrowserRouter mount |
| `App.tsx` | Layout: w-64 sidebar with NavLinks (Dashboard, Library, Import, Convert, Normalize, Settings) + main content area. CineForge branding with video camera icon. v2.0.0. Route for `/jobs/:id` (JobDetail page). |
| `index.css` | Tailwind directives + dark theme custom properties |
| `api/client.ts` | Full API client with types for all endpoints. SSE stream parser for convert flow. Library types (`LibraryMovie`, `MovieFile`, `MediaInfo`, `FilterOptions`, `LibraryResponse` with `cached_at`, `normalized_ids`). Normalize types (`NormalizeCandidate`, `NormalizeConfig`, `NormalizeJob`, `NormalizeJobDetail`, `NormalizeJobItem`, `NormalizeStatusEvent`, `NormalizeItemStatus`). Reconcile types (`ReconciledResult`, `ReconcileResponse`). Functions: `getLibrary`, `refreshLibrary`, `getNormalizeCandidates`, `startNormalize`, `stopNormalize`, `subscribeNormalizeStatus`, `getNormalizeJobs` (paginated), `getNormalizeJob`, `getNormalizeConfig`, `updateNormalizeConfig`, `retryNormalize`, `clearNormalizeHistory`, `reconcileJob` |

### `frontend/src/pages/`

| File | Purpose |
|------|---------|
| `Dashboard.tsx` | 4-card quick-link grid: Library (violet), Import (gold), Convert (blue), Normalize (teal). Active conversions vs History sections. History items link to `/jobs/:id`. |
| `Library.tsx` | Full Radarr library browser with poster-card grid view (default, clean poster + info panel below) and table list view toggle. Refresh button; "Updated X ago" timestamp. Collapsible filter sidebar (search, has file, monitored, hide normalized, video codec, audio codec, genre, tags). Sortable. Multi-select with "Normalize Selected" action. Violet accent. |
| `Normalize.tsx` | Top-level tabs: Normalize + History. Normalize tab: candidate selection (Imported + Library Selection), beginner-friendly settings panel with LUFS presets and Save button, running phase with overall + per-file progress bars, results summary. History tab: paginated list of past jobs with expandable detail (Before/After LUFS), Retry Failed button (marks originals as 'retried'). Teal accent. |
| `Import.tsx` | Step flow: upload JSON → preview table → import with tags |
| `Convert.tsx` | Step flow: upload JSON → SSE matching → review/select matches → import. Resumable sessions |
| `Settings.tsx` | Config form: Radarr URL/key, TMDb key, quality profile dropdown, root folder dropdown, import defaults. Normalize Defaults section (LUFS, HW accel, audio bitrate, video mode, parallel jobs, backup). Data Management section (Clear Normalize History with confirm dialog). |
| `JobDetail.tsx` | Job detail view: header with summary stats, filterable results table (title, TMDb/IMDb, status, error). Reconcile with Radarr button (persisted across restarts). Expandable error sub-rows with fixed-width table columns. Retry Failed/Missing button. |

### `frontend/src/components/`

| File | Purpose |
|------|---------|
| `FileUpload.tsx` | Drag-and-drop JSON upload with validation |
| `MovieTable.tsx` | Preview table with poster, title, year, status. Optional checkbox selection |
| `ProgressBar.tsx` | Polls `GET /api/jobs/{id}` every second, shows progress bar and result counts |
| `TagSelector.tsx` | Tag multi-select with inline creation |

---

## Root Config Files

| File | Purpose |
|------|---------|
| `Dockerfile` | 3-stage: Node 20 (frontend build) → Go 1.22 (backend build) → Alpine 3.20 with ffmpeg (runtime). Binary: `cineforge` |
| `docker-compose.yml` | Service `cineforge` on port 8085:8080, `app-data` volume (explicit name: `cineforge-data`) for `/data`, commented media volume mount |
| `docker-compose.override.yml` | Network override for `grunklestan_default`, media mount at `/media/movies`, `/dev/dri` device for VAAPI |
| `docker-compose.override.example.yml` | Example override with media volume and DRI device |
| `.dockerignore` | Excludes node_modules, dist, etc. |
| `scripts/recover-volume.sh` | Recovery script for migrating data from old `radarr-importer_app-data` Docker volume to new `cineforge-data` volume |
| `.cursor/rules/data-safety.mdc` | Cursor rule: never rename volumes, db files, or project dirs without user confirmation and recovery plan |

---

## Key Technical Details

### Radarr API surface used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v3/movie` | Library browser (all movies + nested movieFile/mediaInfo) |
| `GET /api/v3/movie/{id}` | Single movie detail |
| `GET /api/v3/moviefile?movieId={id}` | Get file paths for normalization |
| `GET /api/v3/movie/lookup?term=tmdb:{id}` | Import lookup |
| `POST /api/v3/movie` | Add movie to Radarr |
| `GET /api/v3/qualityprofile` | Quality profile selection |
| `GET /api/v3/rootfolder` | Root folder selection |
| `GET /api/v3/tag` | Tag resolution for library filters |
| `POST /api/v3/tag` | Create tags |
| `GET /api/v3/system/status` | Connection test |

### ffmpeg commands (Go-native in normalize engine)

**Measure pass:**
```
ffmpeg -hide_banner -i {file} -map 0:a:0 -af "loudnorm=I={target}:TP=-1.5:LRA=11:print_format=json" -f null -
```

**Normalize pass (with -progress for real-time parsing):**
```
ffmpeg -y -progress pipe:1 -hide_banner -i {file} \
  -map 0:v -map 0:a:0 \
  -c:v copy \
  -af "loudnorm=I={target}:TP=-1.5:LRA=11:measured_I={i}:measured_TP={tp}:measured_LRA={lra}:measured_thresh={thresh}:offset={offset}:linear=true" \
  -c:a aac -b:a 320k \
  {temp_output}
```

Falls back to full video re-encode (libx264/h264_vaapi/h264_nvenc) if `-c:v copy` fails. Files already within 0.5 LU of target are skipped (EBU R128 tolerance).

### HW acceleration concurrency limits
- **NVENC**: max 2 concurrent sessions
- **VAAPI**: max 4 concurrent sessions
- **CPU**: max 2 concurrent sessions

### Normalize item status state machine

`pending` → `measuring` → `normalizing` → `done` / `failed` / `skipped`

Failed items can be retried, which transitions them to `retried` in the original job and creates new items in a new job.

### Navigation structure

```
CineForge (sidebar)
├── Dashboard       (HomeIcon)
├── Library         (FilmIcon - violet accent)
├── Import          (DownloadIcon - radarr gold)
├── Convert         (RefreshIcon - blue)
├── Normalize       (AdjustmentsIcon - teal accent)
└── Settings        (GearIcon)
```

---

## Expert Agent Recommendations

Three specialist agents provide domain expertise. Their guidance informed the architecture and should continue to be consulted for future changes in their respective domains.

### Web Designer

Responsible for visual identity, layout, interaction patterns, and UX.

- **Accent color**: Teal (`teal-400: #2dd4bf`, `teal-500: #14b8a6`, `teal-600: #0d9488`) for Normalize; Violet for Library
- **Layout**: Collapsible settings panel → candidates table with selection → nested progress bars (overall + per-file) → results summary
- **Icon**: AdjustmentsHorizontal heroicon (sliders suggesting "adjusting levels")
- **Dashboard**: Four-card grid in `md:grid-cols-2 lg:grid-cols-4` with Library, Import, Convert, Normalize
- **Progress**: Nested bars showing overall job + current file ffmpeg stats (time, fps, speed)
- **UX**: Load candidates on button click, confirmation modal before starting, step-based view transitions
- **Library**: Poster-card grid (default) + table list view toggle. Refresh button with "Updated X ago". Collapsible filter sidebar. Multi-select with "Normalize Selected" action bridging to Normalize page via URL params. `MovieCard` with clean poster, info panel below (title, year/runtime, codecs/size), resolution/HDR badges
- **Normalize UX**: Beginner-friendly LUFS presets with plain-language descriptions; advanced settings hidden behind toggle; `InfoTip` tooltips on every technical setting
- **Tables**: Use `table-layout: fixed` with `<colgroup>` for stable column widths; expandable detail sub-rows for long content (errors)

### Audio/Video Engineer

Expert in FFmpeg encoding, loudness standards, and media processing pipelines.

- **Stream selection**: Use `-map 0:v -map 0:a:0` to target first audio stream explicitly
- **Progress parsing**: Use `-progress pipe:1` instead of parsing `-stats` stderr (structured `key=value` output, parse `out_time_us` for percentage)
- **Audio-only option**: Try `-c:v copy` first (much faster, no quality loss), fall back to full re-encode on failure
- **LUFS compliance**: Skip re-encode if measured LUFS is within 0.5 LU of target (EBU R128 tolerance)
- **HW accel limits**: NVENC cap at 2 concurrent sessions, VAAPI/VT up to 4, CPU 2
- **Duration**: Get via `ffprobe -show_entries format=duration -of default=noprint_wrappers=1:nokey=1`
- **Error handling**: Check for known stderr patterns, validate output file size and duration vs input
- **Temp strategy**: Write to `{name}_temp{ext}`, atomic rename on success, cleanup on interrupt

### SQLite Specialist

Focused on schema design, query performance, and data integrity.

- **Schema**: Separate `normalize_jobs`, `normalize_items`, `normalize_history` tables (not extending `jobs`)
- **Discovery**: New `imported_movies` table populated during import (not JSON parsing) with backfill from existing job results
- **History**: `normalize_history` keyed on `(file_path, file_size, file_mtime, target_lufs)` matching plex-scripts cache semantics
- **State machine**: pending → measuring → normalizing → done/failed/skipped/retried
- **Indexes**: `normalize_items(job_id)`, `normalize_items(job_id, status)`, `normalize_history(file_path)`, `imported_movies(tmdb_id)`
- **Interruption recovery**: On startup, detect `normalize_jobs` with `status='running'` and reset in-progress items back to `pending`. Blanket sweep of intermediate states (`measuring`/`normalizing`) across all jobs with recount of parent job summaries.
- **WAL**: Fine for concurrent SSE reads during normalization writes; use short transactions

---

## Build and Run

```bash
# Development
cd frontend && npm install && npm run dev   # Frontend on :5173
cd backend && go run .                       # Backend on :8080

# Docker
docker compose up --build
```
