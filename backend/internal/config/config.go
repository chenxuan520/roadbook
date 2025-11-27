package config

import (
	"encoding/json"
	"fmt"
	"os"
)

// UserCredentials holds the salt and hashed password for a user.
type UserCredentials struct {
	Salt string `json:"salt"`
	Hash string `json:"hash"`
}

type Config struct {
	Port                  int                          `json:"port"`
	AllowedOrigins        []string                     `json:"allowed_origins"`
	AllowNullOriginForDev bool                         `json:"allow_null_origin_for_dev,omitempty"`
	JwtSecret             string                       `json:"jwtSecret"`
	Users                 map[string]UserCredentials `json:"users"`
}

func Load() (Config, error) {
	var config Config

	file, err := os.ReadFile("configs/config.json")
	if err != nil {
		return config, fmt.Errorf("config file not found or error reading: %w", err)
	}

	err = json.Unmarshal(file, &config)
	if err != nil {
		return config, fmt.Errorf("error parsing config file: %w", err)
	}

	if config.Port <= 0 || config.Port > 65535 {
		// Fallback to a default port if the configured one is invalid, but log it.
		fmt.Println("Invalid port in config, using default port 8080")
		config.Port = 8080
	}

	// 检查 JwtSecret 是否为空
	if config.JwtSecret == "" {
		return config, fmt.Errorf("jwtSecret must not be empty in config")
	}

	// 检查 Users 是否为空
	if len(config.Users) == 0 {
		return config, fmt.Errorf("users must not be empty in config")
	}

	return config, nil
}

