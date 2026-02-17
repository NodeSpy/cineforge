package db

import (
	"database/sql"
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

	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return fmt.Errorf("failed to create data directory: %w", err)
	}

	dbPath := filepath.Join(dataDir, "radarr-importer.db")
	var err error
	DB, err = sql.Open("sqlite", dbPath+"?_pragma=journal_mode(wal)")
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	if err := DB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	return migrate()
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
	}

	for _, m := range migrations {
		if _, err := DB.Exec(m); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}

	// Column additions (ALTER TABLE) -- silently ignore "duplicate column" errors
	alterMigrations := []string{
		`ALTER TABLE conversion_sessions ADD COLUMN source_json TEXT NOT NULL DEFAULT ''`,
	}
	for _, m := range alterMigrations {
		DB.Exec(m) // ignore error if column already exists
	}

	return nil
}

func Close() {
	if DB != nil {
		DB.Close()
	}
}
