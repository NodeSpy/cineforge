package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

func Init() error {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "/data"
	}

	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return fmt.Errorf("failed to create data directory: %w", err)
	}

	dbPath := filepath.Join(dataDir, "cineforge.db")
	oldPath := filepath.Join(dataDir, "radarr-importer.db")
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		if _, err := os.Stat(oldPath); err == nil {
			os.Rename(oldPath, dbPath)
		}
	}

	var openErr error
	DB, openErr = sql.Open("sqlite", dbPath+"?_pragma=journal_mode(wal)")
	if openErr != nil {
		return fmt.Errorf("failed to open database: %w", openErr)
	}

	if err := DB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	if err := migrate(); err != nil {
		return err
	}
	BackfillImportedMovies()
	BackfillSessionJobIDs()
	RecoverStaleNormalizeJobs()
	return nil
}

func migrate() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS config (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			encrypted INTEGER DEFAULT 0,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS jobs (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			total INTEGER DEFAULT 0,
			completed INTEGER DEFAULT 0,
			succeeded INTEGER DEFAULT 0,
			failed INTEGER DEFAULT 0,
			results TEXT DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS conversion_sessions (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'matching',
			total INTEGER DEFAULT 0,
			matched INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS conversion_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			item_index INTEGER NOT NULL,
			original_title TEXT NOT NULL DEFAULT '',
			original_year TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'not_found',
			matches_json TEXT NOT NULL DEFAULT '[]',
			selected_tmdb_id INTEGER DEFAULT 0,
			imported INTEGER DEFAULT 0,
			FOREIGN KEY (session_id) REFERENCES conversion_sessions(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS imported_movies (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			tmdb_id INTEGER NOT NULL,
			imdb_id TEXT DEFAULT '',
			title TEXT DEFAULT '',
			job_id TEXT NOT NULL,
			imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (tmdb_id, job_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_imported_movies_tmdb_id ON imported_movies(tmdb_id)`,
		`CREATE TABLE IF NOT EXISTS normalize_jobs (
			id TEXT PRIMARY KEY,
			status TEXT NOT NULL DEFAULT 'pending',
			total INTEGER DEFAULT 0,
			completed INTEGER DEFAULT 0,
			succeeded INTEGER DEFAULT 0,
			failed INTEGER DEFAULT 0,
			skipped INTEGER DEFAULT 0,
			config_snapshot TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS normalize_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			job_id TEXT NOT NULL,
			item_index INTEGER NOT NULL,
			file_path TEXT NOT NULL,
			movie_title TEXT DEFAULT '',
			radarr_movie_id INTEGER DEFAULT 0,
			tmdb_id INTEGER DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'pending',
			measured_lufs REAL DEFAULT NULL,
			target_lufs REAL DEFAULT NULL,
			error TEXT DEFAULT '',
			duration_secs REAL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (job_id) REFERENCES normalize_jobs(id) ON DELETE CASCADE,
			UNIQUE (job_id, item_index)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_normalize_items_job_id ON normalize_items(job_id)`,
		`CREATE TABLE IF NOT EXISTS normalize_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			file_path TEXT NOT NULL,
			file_size INTEGER DEFAULT 0,
			file_mtime INTEGER DEFAULT 0,
			target_lufs REAL NOT NULL,
			measured_lufs REAL DEFAULT NULL,
			normalized_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			job_id TEXT DEFAULT '',
			UNIQUE (file_path, file_size, file_mtime, target_lufs)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_normalize_history_file_path ON normalize_history(file_path)`,
		`CREATE TABLE IF NOT EXISTS library_cache (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			radarr_id INTEGER NOT NULL UNIQUE,
			data_json TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS library_cache_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS sonarr_library_cache (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			sonarr_id INTEGER NOT NULL UNIQUE,
			data_json TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS sonarr_library_cache_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
	}

	for _, m := range migrations {
		if _, err := DB.Exec(m); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}

	// Column additions (ALTER TABLE) -- silently ignore "duplicate column" errors
	alterMigrations := []string{
		`ALTER TABLE conversion_sessions ADD COLUMN source_json TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE normalize_items ADD COLUMN progress_pct REAL DEFAULT 0`,
		`ALTER TABLE conversion_sessions ADD COLUMN job_id TEXT DEFAULT ''`,
		`ALTER TABLE jobs ADD COLUMN reconciled_results TEXT DEFAULT ''`,
		`ALTER TABLE jobs ADD COLUMN reconciled_at DATETIME DEFAULT NULL`,
	}
	for _, m := range alterMigrations {
		DB.Exec(m) // ignore error if column already exists
	}

	return nil
}

type importResult struct {
	Title  string `json:"title"`
	TmdbID int    `json:"tmdb_id"`
	ImdbID string `json:"imdb_id"`
	Status string `json:"status"`
	Error  string `json:"error"`
}

func BackfillImportedMovies() {
	rows, err := DB.Query("SELECT id, results FROM jobs WHERE type = 'import' AND status = 'completed'")
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var jobID, resultsJSON string
		if err := rows.Scan(&jobID, &resultsJSON); err != nil {
			continue
		}
		var results []importResult
		if err := json.Unmarshal([]byte(resultsJSON), &results); err != nil {
			continue
		}
		for _, r := range results {
			if r.Status == "success" && r.TmdbID > 0 {
				DB.Exec("INSERT OR IGNORE INTO imported_movies (tmdb_id, imdb_id, title, job_id) VALUES (?, ?, ?, ?)",
					r.TmdbID, r.ImdbID, r.Title, jobID)
			}
		}
	}
}

func BackfillSessionJobIDs() {
	rows, err := DB.Query(
		"SELECT id, updated_at FROM conversion_sessions WHERE (job_id = '' OR job_id IS NULL) AND status IN ('importing', 'done')")
	if err != nil {
		return
	}
	defer rows.Close()

	type staleSession struct {
		id        string
		updatedAt string
	}
	var sessions []staleSession
	for rows.Next() {
		var s staleSession
		if err := rows.Scan(&s.id, &s.updatedAt); err != nil {
			continue
		}
		sessions = append(sessions, s)
	}

	for _, s := range sessions {
		var jobID string
		err := DB.QueryRow(
			`SELECT id FROM jobs WHERE type = 'import' AND status = 'completed'
			 ORDER BY ABS(julianday(created_at) - julianday(?)) ASC LIMIT 1`,
			s.updatedAt,
		).Scan(&jobID)
		if err != nil {
			DB.Exec("UPDATE conversion_sessions SET status = 'done' WHERE id = ?", s.id)
			continue
		}
		DB.Exec("UPDATE conversion_sessions SET job_id = ?, status = 'done' WHERE id = ?", jobID, s.id)
	}
}

func RecoverStaleNormalizeJobs() {
	rows, err := DB.Query("SELECT id FROM normalize_jobs WHERE status = 'running'")
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var jobID string
		if err := rows.Scan(&jobID); err != nil {
			continue
		}
		DB.Exec("UPDATE normalize_items SET status = 'pending' WHERE job_id = ? AND status IN ('measuring', 'normalizing')", jobID)
		DB.Exec("UPDATE normalize_jobs SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", jobID)
	}

	// Clean up any items stuck in intermediate states across ALL jobs,
	// catching orphans from panics, killed processes, etc.
	DB.Exec("UPDATE normalize_items SET status = 'failed', error = 'interrupted - recovered on restart' WHERE status IN ('measuring', 'normalizing')")

	// Recount job summaries to match actual item statuses for affected jobs
	DB.Exec(`UPDATE normalize_jobs SET
		succeeded = (SELECT COUNT(*) FROM normalize_items WHERE job_id = normalize_jobs.id AND status = 'done'),
		failed = (SELECT COUNT(*) FROM normalize_items WHERE job_id = normalize_jobs.id AND status = 'failed'),
		skipped = (SELECT COUNT(*) FROM normalize_items WHERE job_id = normalize_jobs.id AND status = 'skipped'),
		completed = (SELECT COUNT(*) FROM normalize_items WHERE job_id = normalize_jobs.id AND status IN ('done','failed','skipped'))
	WHERE id IN (SELECT DISTINCT job_id FROM normalize_items WHERE error = 'interrupted - recovered on restart')`)
}

func Close() {
	if DB != nil {
		DB.Close()
	}
}
