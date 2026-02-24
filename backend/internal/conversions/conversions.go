package conversions

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"cineforge/internal/db"
	"cineforge/internal/tmdb"
)

const maxSourceJSONSize = 1 << 20 // 1 MB

type Session struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Status     string    `json:"status"` // matching, ready, importing, done
	Total      int       `json:"total"`
	Matched    int       `json:"matched"`
	JobID      string    `json:"job_id,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	Items      []Item    `json:"items,omitempty"`
	SourceJSON string    `json:"-"` // never sent to frontend
}

type Item struct {
	ID             int          `json:"id"`
	SessionID      string       `json:"session_id"`
	ItemIndex      int          `json:"item_index"`
	OriginalTitle  string       `json:"original_title"`
	OriginalYear   string       `json:"original_year"`
	Status         string       `json:"status"` // matched, multiple, not_found
	Matches        []tmdb.Movie `json:"matches"`
	SelectedTmdbID int          `json:"selected_tmdb_id"`
	Imported       bool         `json:"imported"`
}

// CreateSession creates a new conversion session. sourceJSON is stored only if under 1MB.
func CreateSession(name string, total int, sourceJSON string) (*Session, error) {
	storedJSON := ""
	if len(sourceJSON) <= maxSourceJSONSize {
		storedJSON = sourceJSON
	}

	s := &Session{
		ID:         uuid.New().String(),
		Name:       name,
		Status:     "matching",
		Total:      total,
		SourceJSON: storedJSON,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	_, err := db.DB.Exec(
		`INSERT INTO conversion_sessions (id, name, status, total, matched, source_json, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
		s.ID, s.Name, s.Status, s.Total, s.SourceJSON, s.CreatedAt, s.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	return s, nil
}

// AddItem persists a single conversion result to a session.
func AddItem(sessionID string, index int, originalTitle, originalYear, status string, matches []tmdb.Movie, selectedTmdbID int) error {
	matchesJSON, err := json.Marshal(matches)
	if err != nil {
		return err
	}

	_, err = db.DB.Exec(
		`INSERT INTO conversion_items (session_id, item_index, original_title, original_year, status, matches_json, selected_tmdb_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		sessionID, index, originalTitle, originalYear, status, string(matchesJSON), selectedTmdbID,
	)
	return err
}

// SetSessionStatus updates only the session status without touching the matched count.
func SetSessionStatus(sessionID, status string) error {
	_, err := db.DB.Exec(
		`UPDATE conversion_sessions SET status = ?, updated_at = ? WHERE id = ?`,
		status, time.Now(), sessionID,
	)
	return err
}

// UpdateSessionStatus updates the session status and matched count.
func UpdateSessionStatus(sessionID, status string, matched int) error {
	_, err := db.DB.Exec(
		`UPDATE conversion_sessions SET status = ?, matched = ?, updated_at = ? WHERE id = ?`,
		status, matched, time.Now(), sessionID,
	)
	return err
}

// GetSession returns a session with all its items.
func GetSession(sessionID string) (*Session, error) {
	s := &Session{}
	err := db.DB.QueryRow(
		`SELECT id, name, status, total, matched, source_json, created_at, updated_at FROM conversion_sessions WHERE id = ?`,
		sessionID,
	).Scan(&s.ID, &s.Name, &s.Status, &s.Total, &s.Matched, &s.SourceJSON, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, err
	}

	rows, err := db.DB.Query(
		`SELECT id, session_id, item_index, original_title, original_year, status, matches_json, selected_tmdb_id, imported
		 FROM conversion_items WHERE session_id = ? ORDER BY item_index`,
		sessionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	s.Items = make([]Item, 0)
	for rows.Next() {
		var item Item
		var matchesJSON string
		var imported int
		if err := rows.Scan(&item.ID, &item.SessionID, &item.ItemIndex, &item.OriginalTitle, &item.OriginalYear,
			&item.Status, &matchesJSON, &item.SelectedTmdbID, &imported); err != nil {
			continue
		}
		item.Imported = imported == 1
		json.Unmarshal([]byte(matchesJSON), &item.Matches)
		s.Items = append(s.Items, item)
	}

	return s, nil
}

// ListSessions returns all sessions that are not done (active sessions).
func ListSessions() ([]Session, error) {
	rows, err := db.DB.Query(
		`SELECT id, name, status, total, matched, created_at, updated_at
		 FROM conversion_sessions WHERE status NOT IN ('done', 'importing') ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sessions := make([]Session, 0)
	for rows.Next() {
		var s Session
		if err := rows.Scan(&s.ID, &s.Name, &s.Status, &s.Total, &s.Matched, &s.CreatedAt, &s.UpdatedAt); err != nil {
			continue
		}
		sessions = append(sessions, s)
	}

	return sessions, nil
}

// ListAllSessions returns all sessions including done/importing ones.
func ListAllSessions() ([]Session, error) {
	rows, err := db.DB.Query(
		`SELECT id, name, status, total, matched, COALESCE(job_id, ''), created_at, updated_at
		 FROM conversion_sessions ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sessions := make([]Session, 0)
	for rows.Next() {
		var s Session
		if err := rows.Scan(&s.ID, &s.Name, &s.Status, &s.Total, &s.Matched, &s.JobID, &s.CreatedAt, &s.UpdatedAt); err != nil {
			continue
		}
		sessions = append(sessions, s)
	}

	return sessions, nil
}

// SetSessionJobID links a conversion session to its import job.
func SetSessionJobID(sessionID, jobID string) error {
	_, err := db.DB.Exec(
		`UPDATE conversion_sessions SET job_id = ? WHERE id = ?`,
		jobID, sessionID,
	)
	return err
}

// GetSessionSourceData loads and parses the stored source JSON for a session.
func GetSessionSourceData(sessionID string) ([]map[string]interface{}, error) {
	var sourceJSON string
	err := db.DB.QueryRow(
		`SELECT source_json FROM conversion_sessions WHERE id = ?`,
		sessionID,
	).Scan(&sourceJSON)
	if err != nil {
		return nil, err
	}

	if sourceJSON == "" {
		return nil, fmt.Errorf("no source data stored for session %s", sessionID)
	}

	var items []map[string]interface{}
	if err := json.Unmarshal([]byte(sourceJSON), &items); err != nil {
		return nil, fmt.Errorf("failed to parse source data: %w", err)
	}

	return items, nil
}

// ClearSourceJSON removes the stored source data from a session.
func ClearSourceJSON(sessionID string) error {
	_, err := db.DB.Exec(
		`UPDATE conversion_sessions SET source_json = '' WHERE id = ?`,
		sessionID,
	)
	return err
}

// GetMatchedIndexes returns the set of item_index values that already exist for a session.
func GetMatchedIndexes(sessionID string) (map[int]bool, error) {
	rows, err := db.DB.Query(
		`SELECT item_index FROM conversion_items WHERE session_id = ?`,
		sessionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	indexes := make(map[int]bool)
	for rows.Next() {
		var idx int
		if err := rows.Scan(&idx); err != nil {
			continue
		}
		indexes[idx] = true
	}

	return indexes, nil
}

// UpdateSelection updates the selected TMDb ID for a specific item in a session.
func UpdateSelection(sessionID string, itemIndex int, tmdbID int) error {
	_, err := db.DB.Exec(
		`UPDATE conversion_items SET selected_tmdb_id = ? WHERE session_id = ? AND item_index = ?`,
		tmdbID, sessionID, itemIndex,
	)
	return err
}

// MarkItemImported marks a specific item as successfully imported.
func MarkItemImported(sessionID string, tmdbID int) error {
	_, err := db.DB.Exec(
		`UPDATE conversion_items SET imported = 1 WHERE session_id = ? AND selected_tmdb_id = ?`,
		sessionID, tmdbID,
	)
	return err
}

// DeleteImportedItems removes all imported items from a session and checks if the session is complete.
func DeleteImportedItems(sessionID string) error {
	_, err := db.DB.Exec(
		`DELETE FROM conversion_items WHERE session_id = ? AND imported = 1`,
		sessionID,
	)
	if err != nil {
		return err
	}

	var remaining int
	err = db.DB.QueryRow(
		`SELECT COUNT(*) FROM conversion_items WHERE session_id = ?`,
		sessionID,
	).Scan(&remaining)
	if err != nil {
		return err
	}

	if remaining == 0 {
		return DeleteSession(sessionID)
	}

	return nil
}

// DeleteSession removes a session and all its items.
func DeleteSession(sessionID string) error {
	tx, err := db.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM conversion_items WHERE session_id = ?`, sessionID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM conversion_sessions WHERE id = ?`, sessionID); err != nil {
		return err
	}

	return tx.Commit()
}
