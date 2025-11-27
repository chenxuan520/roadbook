package server

import (
	"log"     // 导入 log 包用于错误处理

	"github.com/chenxuan520/roadmap/backend/internal/auth"
	"github.com/chenxuan520/roadmap/backend/internal/config"
	"github.com/chenxuan520/roadmap/backend/internal/handler"
	"github.com/chenxuan520/roadmap/backend/internal/middleware"
	"github.com/chenxuan520/roadmap/backend/internal/plan" // 导入 plan 包
	"github.com/gin-gonic/gin"
)

func NewRouter(cfg config.Config) *gin.Engine {
	r := gin.Default()

	// Secure CORS Middleware
	r.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		isAllowed := false

		// Check standard allowed origins
		for _, allowedOrigin := range cfg.AllowedOrigins {
			if origin == allowedOrigin {
				isAllowed = true
				break
			}
		}

		// If not in standard list, check for dev-mode null origin
		if !isAllowed && cfg.AllowNullOriginForDev && origin == "null" {
			isAllowed = true
		}

		if isAllowed {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		}

		if c.Request.Method == "OPTIONS" {
			if isAllowed {
				c.AbortWithStatus(204)
			} else {
				c.AbortWithStatus(403)
			}
			return
		}

		c.Next()
	})

	// 初始化服务和处理器
	authService := auth.NewService(cfg)
	planRepo, err := plan.NewFileRepository()
	if err != nil {
		log.Fatalf("初始化计划仓库失败: %v", err) // 如果仓库初始化失败，则终止应用
	}

	authHandler := handler.NewAuthHandler(authService)
	planHandler := handler.NewPlanHandler(planRepo)

	// API v1 路由组
	v1 := r.Group("/api/v1")
	{
		// 认证接口
		v1.POST("/login", middleware.RateLimitMiddleware(), authHandler.LoginHandler) // 登录接口应用IP限流

		// 计划分享接口 (无需认证)
		share := v1.Group("/share")
		{
			share.GET("/plans/:id", planHandler.SharePlanHandler)
		}

		// 需要JWT认证的计划管理接口
		authenticated := v1.Group("/")
		authenticated.Use(middleware.JWTAuthMiddleware(authService))
		{
			authenticated.POST("/plans", planHandler.CreatePlanHandler)
			authenticated.GET("/plans", planHandler.ListPlansHandler)
			authenticated.GET("/plans/:id", planHandler.GetPlanHandler)
			authenticated.PUT("/plans/:id", planHandler.SavePlanHandler)
			authenticated.DELETE("/plans/:id", planHandler.DeletePlanHandler)
		}

		// 现有cnmap/tianmap搜索接口
		// 如果需要统一到v1，则需要修改，目前保持原有路径
		// api := r.Group("/api")
		// {
		// 	api.GET("/cnmap/search", handler.BaiduSearchHandler)
		// 	api.GET("/tianmap/search", handler.TianmapSearchHandler)
		// }
	}

	// 保留原有 /api 组用于现有搜索接口
	api := r.Group("/api")
	{
		api.GET("/cnmap/search", handler.BaiduSearchHandler)
		api.GET("/tianmap/search", handler.TianmapSearchHandler)
		// 新增trafficpos接口
		api.GET("/trafficpos", handler.GetTrafficPos)
	}

	return r
}
