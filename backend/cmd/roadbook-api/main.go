package main

import (
	"fmt"
	"github.com/chenxuan520/roadmap/backend/internal/config"
	"github.com/chenxuan520/roadmap/backend/internal/server"
)

func main() {
	cfg := config.Load()

	r := server.NewRouter(cfg)

	portStr := fmt.Sprintf(":%d", cfg.Port)
	fmt.Printf("Server running on %s\n", portStr)
	fmt.Printf("Try Baidu: http://localhost:%d/api/cnmap/search?q=清华大学\n", cfg.Port)
	fmt.Printf("Try Tian:  http://localhost:%d/api/tianmap/search?q=清华大学\n", cfg.Port)

	r.Run(portStr)
}
