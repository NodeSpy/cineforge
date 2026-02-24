package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"cineforge/internal/db"
)

type AppConfig struct {
	RadarrURL        string `json:"radarr_url"`
	RadarrAPIKey     string `json:"radarr_api_key"`
	TMDbAPIKey       string `json:"tmdb_api_key"`
	QualityProfileID int    `json:"quality_profile_id"`
	RootFolderPath   string `json:"root_folder_path"`
	MinAvailability  string `json:"min_availability"`
	SearchOnAdd      bool   `json:"search_on_add"`
	Monitored        bool   `json:"monitored"`
}

var sensitiveKeys = map[string]bool{
	"radarr_api_key": true,
	"tmdb_api_key":   true,
}

func getEncryptionKey() []byte {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-insecure-key-change-me"
	}
	hash := sha256.Sum256([]byte(secret))
	return hash[:]
}

func encrypt(plaintext string) (string, error) {
	key := getEncryptionKey()
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return hex.EncodeToString(ciphertext), nil
}

func decrypt(ciphertextHex string) (string, error) {
	key := getEncryptionKey()
	ciphertext, err := hex.DecodeString(ciphertextHex)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

func Get() (AppConfig, error) {
	rows, err := db.DB.Query("SELECT key, value, encrypted FROM config")
	if err != nil {
		return AppConfig{}, err
	}
	defer rows.Close()

	values := make(map[string]string)
	for rows.Next() {
		var key, value string
		var encrypted int
		if err := rows.Scan(&key, &value, &encrypted); err != nil {
			continue
		}
		if encrypted == 1 {
			decrypted, err := decrypt(value)
			if err != nil {
				continue
			}
			value = decrypted
		}
		values[key] = value
	}

	cfg := AppConfig{
		RadarrURL:       values["radarr_url"],
		RadarrAPIKey:    values["radarr_api_key"],
		TMDbAPIKey:      values["tmdb_api_key"],
		RootFolderPath:  values["root_folder_path"],
		MinAvailability: values["min_availability"],
	}

	if v, ok := values["quality_profile_id"]; ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.QualityProfileID = n
		}
	}

	if v, ok := values["search_on_add"]; ok {
		cfg.SearchOnAdd = v == "true"
	}

	if v, ok := values["monitored"]; ok {
		cfg.Monitored = v == "true"
	}

	if cfg.MinAvailability == "" {
		cfg.MinAvailability = "announced"
	}

	return cfg, nil
}

func SetFields(fields map[string]string) error {
	for key, value := range fields {
		isEncrypted := 0
		storeValue := value

		if sensitiveKeys[key] && value != "" {
			encrypted, err := encrypt(value)
			if err != nil {
				return fmt.Errorf("failed to encrypt %s: %w", key, err)
			}
			storeValue = encrypted
			isEncrypted = 1
		}

		_, err := db.DB.Exec(
			`INSERT INTO config (key, value, encrypted, updated_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET value=excluded.value, encrypted=excluded.encrypted, updated_at=excluded.updated_at`,
			key, storeValue, isEncrypted, time.Now(),
		)
		if err != nil {
			return fmt.Errorf("failed to set config key %s: %w", key, err)
		}
	}

	return nil
}

func GetMasked() (AppConfig, error) {
	cfg, err := Get()
	if err != nil {
		return cfg, err
	}

	if cfg.RadarrAPIKey != "" {
		cfg.RadarrAPIKey = maskSecret(cfg.RadarrAPIKey)
	}
	if cfg.TMDbAPIKey != "" {
		cfg.TMDbAPIKey = maskSecret(cfg.TMDbAPIKey)
	}

	return cfg, nil
}

type NormalizeConfig struct {
	TargetLUFS   float64 `json:"target_lufs"`
	HWAccel      string  `json:"hwaccel"`
	AudioBitrate string  `json:"audio_bitrate"`
	Backup       bool    `json:"backup"`
	Parallel     int     `json:"parallel"`
	VideoMode    string  `json:"video_mode"`
}

func GetNormalizeConfig() NormalizeConfig {
	cfg := NormalizeConfig{
		TargetLUFS:   -16.0,
		HWAccel:      "auto",
		AudioBitrate: "320k",
		Backup:       false,
		Parallel:     1,
		VideoMode:    "copy",
	}

	rows, err := db.DB.Query("SELECT key, value FROM config WHERE key LIKE 'normalize_%'")
	if err != nil {
		return cfg
	}
	defer rows.Close()

	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		switch key {
		case "normalize_target_lufs":
			if v, err := strconv.ParseFloat(value, 64); err == nil {
				cfg.TargetLUFS = v
			}
		case "normalize_hwaccel":
			cfg.HWAccel = value
		case "normalize_audio_bitrate":
			cfg.AudioBitrate = value
		case "normalize_backup":
			cfg.Backup = value == "true"
		case "normalize_parallel":
			if v, err := strconv.Atoi(value); err == nil {
				cfg.Parallel = v
			}
		case "normalize_video_mode":
			cfg.VideoMode = value
		}
	}
	return cfg
}

func maskSecret(s string) string {
	if len(s) <= 4 {
		return strings.Repeat("*", len(s))
	}
	return s[:2] + strings.Repeat("*", len(s)-4) + s[len(s)-2:]
}
