package config

import (
	"encoding/json"
	"fmt"
	"os"
)

type Config struct {
	Port           int      `json:"port"`
	AllowedOrigins []string `json:"allowed_origins"`
}

func Load() Config {
	config := Config{
		Port:           8080,       // Default port
		AllowedOrigins: []string{}, // Default to empty
	}

	file, err := os.ReadFile("configs/config.json")
	if err != nil {
		fmt.Println("Config file not found, using default port 8080 and no allowed origins")
		return config
	}

	err = json.Unmarshal(file, &config)
	if err != nil {
		fmt.Println("Error parsing config file, using default port 8080 and no allowed origins")
		return Config{Port: 8080, AllowedOrigins: []string{}}
	}

	if config.Port <= 0 || config.Port > 65535 {
		fmt.Println("Invalid port in config, using default port 8080")
		config.Port = 8080
	}

	return config
}
