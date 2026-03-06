package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"cineforge/internal/db"
)

type AppConfig struct {
	RadarrURL        string `json:"radarr_url"`
	RadarrAPIKey     string `json:"radarr_api_key"`
	SonarrURL        string `json:"sonarr_url"`
	SonarrAPIKey     string `json:"sonarr_api_key"`
	TMDbAPIKey       string `json:"tmdb_api_key"`
	QualityProfileID int    `json:"quality_profile_id"`
	RootFolderPath   string `json:"root_folder_path"`
	MinAvailability  string `json:"min_availability"`
	SearchOnAdd      bool   `json:"search_on_add"`
	Monitored        bool   `json:"monitored"`
}

// sentinelValue is stored in the config map when decryption fails (e.g. APP_SECRET changed).
// GetMasked() shows it as "****" so the UI indicates a value exists; re-enter key to replace.
const sentinelValue = "\x01"

var sensitiveKeys = map[string]bool{
	"radarr_api_key": true,
	"sonarr_api_key": true,
	"tmdb_api_key":   true,
}

var insecureDefaults = map[string]bool{
	"default-insecure-key-change-me":     true,
	"change-me-to-a-random-secret-string": true,
}

var (
	resolvedSecret     string
	resolvedSecretOnce sync.Once
)

func resolveSecret() string {
	resolvedSecretOnce.Do(func() {
		secret := os.Getenv("APP_SECRET")

		if secret != "" && !insecureDefaults[secret] {
			resolvedSecret = secret
			return
		}

		if secret != "" && insecureDefaults[secret] {
			log.Println("WARNING: APP_SECRET is set to a known insecure default -- generating a secure secret instead")
		}

		dataDir := os.Getenv("DATA_DIR")
		if dataDir == "" {
			dataDir = "/data"
		}
		secretFile := filepath.Join(dataDir, ".app_secret")

		if data, err := os.ReadFile(secretFile); err == nil {
			s := strings.TrimSpace(string(data))
			if len(s) >= 32 {
				resolvedSecret = s
				return
			}
		}

		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			log.Fatalf("Failed to generate APP_SECRET: %v", err)
		}
		generated := hex.EncodeToString(b)
		if err := os.WriteFile(secretFile, []byte(generated+"\n"), 0600); err != nil {
			log.Fatalf("Cannot persist APP_SECRET to %s (fix /data mount or set APP_SECRET): %v", secretFile, err)
		}
		// Sync so secret survives container stop/reboot (e.g. Docker stop)
		if f, err := os.OpenFile(secretFile, os.O_RDONLY, 0); err == nil {
			_ = f.Sync()
			_ = f.Close()
		}
		log.Printf("Generated and persisted APP_SECRET to %s", secretFile)
		resolvedSecret = generated
	})
	return resolvedSecret
}

var pbkdf2Salt = []byte("cineforge-encryption-salt-v1")

func getEncryptionKey() []byte {
	secret := resolveSecret()
	key, err := pbkdf2.Key(sha256.New, secret, pbkdf2Salt, 100_000, 32)
	if err != nil {
		log.Fatalf("Failed to derive encryption key: %v", err)
	}
	return key
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
				log.Printf("WARNING: Failed to decrypt config key %q (APP_SECRET may have changed): %v", key, err)
				values[key] = sentinelValue // so GetMasked() shows "****" instead of empty
				continue
			}
			value = decrypted
		}
		values[key] = value
	}

	cfg := AppConfig{
		RadarrURL:       values["radarr_url"],
		RadarrAPIKey:    values["radarr_api_key"],
		SonarrURL:       values["sonarr_url"],
		SonarrAPIKey:    values["sonarr_api_key"],
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
		// Never overwrite a stored secret with empty (preserves keys across partial updates)
		if sensitiveKeys[key] && (value == "" || value == sentinelValue) {
			continue
		}

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

	if cfg.RadarrAPIKey != "" && cfg.RadarrAPIKey != sentinelValue {
		cfg.RadarrAPIKey = maskSecret(cfg.RadarrAPIKey)
	} else if cfg.RadarrAPIKey == sentinelValue {
		cfg.RadarrAPIKey = "****"
	}
	if cfg.SonarrAPIKey != "" && cfg.SonarrAPIKey != sentinelValue {
		cfg.SonarrAPIKey = maskSecret(cfg.SonarrAPIKey)
	} else if cfg.SonarrAPIKey == sentinelValue {
		cfg.SonarrAPIKey = "****"
	}
	if cfg.TMDbAPIKey != "" && cfg.TMDbAPIKey != sentinelValue {
		cfg.TMDbAPIKey = maskSecret(cfg.TMDbAPIKey)
	} else if cfg.TMDbAPIKey == sentinelValue {
		cfg.TMDbAPIKey = "****"
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
	MeasureMode  string  `json:"measure_mode"`
}

func GetNormalizeConfig() NormalizeConfig {
	cfg := NormalizeConfig{
		TargetLUFS:   -16.0,
		HWAccel:      "auto",
		AudioBitrate: "320k",
		Backup:       false,
		Parallel:     2,
		VideoMode:    "copy",
		MeasureMode:  "auto",
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
		case "normalize_measure_mode":
			cfg.MeasureMode = value
		}
	}
	return cfg
}

func maskSecret(s string) string {
	if len(s) <= 4 {
		return "****"
	}
	return "****" + s[len(s)-4:]
}

// SecretForUse returns the secret value for use in API calls. Returns "" if the value is empty or stored but failed to decrypt (sentinel).
func SecretForUse(s string) string {
	if s == "" || s == sentinelValue {
		return ""
	}
	return s
}
