package config

import (
	"encoding/json"
	"fmt"
	"os"
)

type Config struct {
	Port           int               `json:"port"`
	AllowedOrigins []string          `json:"allowed_origins"`
	JwtSecret      string            `json:"jwtSecret"` // 新增
	Users          map[string]string `json:"users"`     // 新增
}

func Load() Config {
	config := Config{
		Port:           8080,       // Default port
		AllowedOrigins: []string{}, // Default to empty
		JwtSecret:      "default_super_secret_jwt_key", // 默认密钥，应被配置文件覆盖
		Users:          map[string]string{"admin": "password"}, // 默认用户
	}

	file, err := os.ReadFile("configs/config.json")
	if err != nil {
		fmt.Println("Config file not found or error reading, using default configuration.")
		return config
	}

	err = json.Unmarshal(file, &config)
	if err != nil {
		fmt.Println("Error parsing config file, using default configuration. Error:", err)
		return Config{
			Port:           8080,
			AllowedOrigins: []string{},
			JwtSecret:      "default_super_secret_jwt_key",
			Users:          map[string]string{"admin": "password"},
		}
	}

	if config.Port <= 0 || config.Port > 65535 {
		fmt.Println("Invalid port in config, using default port 8080")
		config.Port = 8080
	}

	// 检查 JwtSecret 是否为空
	if config.JwtSecret == "" {
		fmt.Println("jwtSecret is empty in config, using default secret.")
		config.JwtSecret = "default_super_secret_jwt_key"
	}

	// 检查 Users 是否为空
	if len(config.Users) == 0 {
		fmt.Println("Users are empty in config, using default user admin/password.")
		config.Users = map[string]string{"admin": "password"}
	}

	return config
}