package main

import (
	"fmt"
	"github.com/chenxuan520/roadmap/backend/internal/config"
	"github.com/chenxuan520/roadmap/backend/internal/handler"
	"github.com/chenxuan520/roadmap/backend/internal/server"
)

func main() {
	cfg := config.Load()

	// 初始化trafficpos数据
	configPath := "./configs" // 配置文件目录
	if err := handler.LoadTrafficPosData(configPath); err != nil {
		fmt.Printf("Warning: Failed to load trafficpos data: %v\n", err)
		// 不中断服务，只是该功能不可用
	}

	r := server.NewRouter(cfg)

	portStr := fmt.Sprintf(":%d", cfg.Port)
	fmt.Printf("Server running on %s\n", portStr)
	fmt.Printf("Try Baidu: http://localhost:%d/api/cnmap/search?q=清华大学\n", cfg.Port)
	fmt.Printf("Try Tian:  http://localhost:%d/api/tianmap/search?q=清华大学\n", cfg.Port)
	fmt.Printf("Try TrafficPos: http://localhost:%d/api/trafficpos?lat=39.9042&lon=116.4074\n", cfg.Port)

	r.Run(portStr)
}
