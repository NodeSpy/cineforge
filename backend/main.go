package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"golang.org/x/time/rate"

	"cineforge/internal/db"
	"cineforge/internal/handlers"
)

//go:embed frontend/dist
var frontendFS embed.FS

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' https://image.tmdb.org data:; style-src 'self' 'unsafe-inline'")
		next.ServeHTTP(w, r)
	})
}

func maxBodySize(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			}
			next.ServeHTTP(w, r)
		})
	}
}

type ipRateLimiter struct {
	mu       sync.Mutex
	limiters map[string]*rateLimiterEntry
	rate     rate.Limit
	burst    int
}

type rateLimiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

func newIPRateLimiter(r rate.Limit, b int) *ipRateLimiter {
	rl := &ipRateLimiter{
		limiters: make(map[string]*rateLimiterEntry),
		rate:     r,
		burst:    b,
	}
	go rl.cleanup()
	return rl
}

func (rl *ipRateLimiter) getLimiter(ip string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	entry, exists := rl.limiters[ip]
	if !exists {
		limiter := rate.NewLimiter(rl.rate, rl.burst)
		rl.limiters[ip] = &rateLimiterEntry{limiter: limiter, lastSeen: time.Now()}
		return limiter
	}
	entry.lastSeen = time.Now()
	return entry.limiter
}

func (rl *ipRateLimiter) cleanup() {
	for {
		time.Sleep(5 * time.Minute)
		rl.mu.Lock()
		for ip, entry := range rl.limiters {
			if time.Since(entry.lastSeen) > 10*time.Minute {
				delete(rl.limiters, ip)
			}
		}
		rl.mu.Unlock()
	}
}

func rateLimitMiddleware(rl *ipRateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip, _, _ := net.SplitHostPort(r.RemoteAddr)
			if ip == "" {
				ip = r.RemoteAddr
			}
			if !rl.getLimiter(ip).Allow() {
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func main() {
	if err := db.Init(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(securityHeaders)
	r.Use(rateLimitMiddleware(newIPRateLimiter(60, 120)))

	if os.Getenv("DEV_CORS") == "true" {
		r.Use(cors.Handler(cors.Options{
			AllowedOrigins: []string{"http://localhost:5173"},
			AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
			AllowedHeaders: []string{"Accept", "Content-Type"},
		}))
		log.Println("WARNING: Development CORS enabled (localhost:5173)")
	}

	// SSE endpoints -- no compression (must come before compressed group)
	r.Post("/api/convert/stream", handlers.ConvertTitlesStream)
	r.Post("/api/convert/resume/{id}", handlers.ResumeConvertStream)
	r.Get("/api/normalize/status/{id}", handlers.GetNormalizeStatus)

	// Regular API routes with compression and body size limit
	r.Group(func(r chi.Router) {
		r.Use(middleware.Compress(5))
		r.Use(maxBodySize(1 << 20)) // 1 MB

		r.Route("/api", func(r chi.Router) {
			r.Get("/config", handlers.GetConfig)
			r.Put("/config", handlers.UpdateConfig)
			r.Post("/config/validate", handlers.ValidateConfig)

			r.Post("/convert", handlers.ConvertTitles)

			r.Get("/conversions", handlers.ListConversions)
			r.Get("/conversions/all", handlers.ListConversionHistory)
			r.Get("/conversions/{id}", handlers.GetConversion)
			r.Put("/conversions/{id}/selection", handlers.UpdateConversionSelection)
			r.Delete("/conversions/{id}", handlers.DeleteConversion)

			r.Post("/import/preview", handlers.PreviewImport)
			r.Post("/import", handlers.ImportMovies)

			r.Get("/radarr/status", handlers.GetRadarrStatus)
			r.Post("/radarr/test", handlers.TestRadarrConnection)
			r.Post("/tmdb/test", handlers.TestTMDbConnection)
			r.Get("/radarr/profiles", handlers.GetQualityProfiles)
			r.Get("/radarr/rootfolders", handlers.GetRootFolders)
			r.Get("/radarr/tags", handlers.GetTags)
			r.Post("/radarr/tags", handlers.CreateTag)

			r.Get("/jobs", handlers.GetRecentJobs)
			r.Get("/jobs/{id}", handlers.GetJob)
			r.Post("/jobs/{id}/reconcile", handlers.ReconcileJob)

			r.Get("/library", handlers.GetLibrary)
			r.Post("/library/refresh", handlers.RefreshLibrary)

			r.Post("/sonarr/test", handlers.TestSonarrConnection)
			r.Get("/sonarr/profiles", handlers.GetSonarrQualityProfiles)
			r.Get("/sonarr/rootfolders", handlers.GetSonarrRootFolders)
			r.Get("/sonarr/tags", handlers.GetSonarrTags)
			r.Post("/sonarr/tags", handlers.CreateSonarrTag)
			r.Get("/sonarr/library", handlers.GetSonarrLibrary)
			r.Post("/sonarr/library/refresh", handlers.RefreshSonarrLibrary)
			r.Get("/sonarr/series/{id}/episodes", handlers.GetSonarrSeriesDetail)

			r.Get("/normalize/hwdetect", handlers.GetHWAccelStatus)
			r.Get("/normalize/hwdetect/test", handlers.TestHWAccel)
			r.Get("/normalize/candidates", handlers.GetNormalizeCandidates)
			r.Get("/normalize/sonarr-candidates", handlers.GetSonarrNormalizeCandidates)
			r.Post("/normalize/start", handlers.StartNormalize)
			r.Post("/normalize/stop/{id}", handlers.StopNormalize)
			r.Post("/normalize/retry/{id}", handlers.RetryNormalize)
			r.Get("/normalize/jobs", handlers.GetNormalizeJobs)
			r.Get("/normalize/jobs/{id}", handlers.GetNormalizeJob)
			r.Get("/normalize/jobs/{id}/pending-candidates", handlers.GetPendingCandidates)
			r.Get("/normalize/config", handlers.GetNormalizeConfigHandler)
			r.Put("/normalize/config", handlers.UpdateNormalizeConfig)
			r.Delete("/normalize/history", handlers.ClearNormalizeHistory)
		})
	})

	// Serve frontend
	distFS, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		log.Fatalf("Failed to get frontend dist: %v", err)
	}
	fileServer := http.FileServer(http.FS(distFS))

	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		// Try serving the file directly
		f, err := distFS.Open(r.URL.Path[1:])
		if err != nil {
			// Fall back to index.html for SPA routing
			r.URL.Path = "/"
		} else {
			f.Close()
		}
		fileServer.ServeHTTP(w, r)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting CineForge on :%s", port)
	if err := http.ListenAndServe(fmt.Sprintf(":%s", port), r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
