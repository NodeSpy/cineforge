package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"cineforge/internal/db"
	"cineforge/internal/handlers"
)

//go:embed frontend/dist
var frontendFS embed.FS

func main() {
	if err := db.Init(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	r := chi.NewRouter()

	// Common middleware
	corsMiddleware := cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Content-Type"},
		ExposedHeaders:   []string{"Content-Length"},
		AllowCredentials: false,
		MaxAge:           300,
	})

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	// SSE endpoints -- no compression (must come before compressed group)
	r.Post("/api/convert/stream", handlers.ConvertTitlesStream)
	r.Post("/api/convert/resume/{id}", handlers.ResumeConvertStream)
	r.Get("/api/normalize/status/{id}", handlers.GetNormalizeStatus)

	// Regular API routes with compression
	r.Group(func(r chi.Router) {
		r.Use(middleware.Compress(5))

		r.Route("/api", func(r chi.Router) {
			r.Get("/config", handlers.GetConfig)
			r.Put("/config", handlers.UpdateConfig)
			r.Get("/config/secrets", handlers.GetSecrets)
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

			r.Get("/normalize/candidates", handlers.GetNormalizeCandidates)
			r.Get("/normalize/sonarr-candidates", handlers.GetSonarrNormalizeCandidates)
			r.Post("/normalize/start", handlers.StartNormalize)
			r.Post("/normalize/stop/{id}", handlers.StopNormalize)
			r.Post("/normalize/retry/{id}", handlers.RetryNormalize)
			r.Get("/normalize/jobs", handlers.GetNormalizeJobs)
			r.Get("/normalize/jobs/{id}", handlers.GetNormalizeJob)
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
