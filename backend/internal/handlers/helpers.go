package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
)

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, userMsg string, err error) {
	if err != nil {
		log.Printf("ERROR: %s: %v", userMsg, err)
	}
	writeJSON(w, status, map[string]string{"error": userMsg})
}

func isMasked(s string) bool {
	return strings.Contains(s, "****")
}

func validateServiceURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("only http/https schemes allowed")
	}
	hostname := u.Hostname()
	if ip := net.ParseIP(hostname); ip != nil {
		if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return fmt.Errorf("loopback and link-local addresses not allowed")
		}
		if ip4 := ip.To4(); ip4 != nil {
			if ip4[0] == 169 && ip4[1] == 254 {
				return fmt.Errorf("link-local address not allowed")
			}
		}
	}
	return nil
}
