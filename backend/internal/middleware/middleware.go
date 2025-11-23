package middleware

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/chenxuan520/roadmap/backend/internal/auth"
	"github.com/chenxuan520/roadmap/backend/internal/handler" // 导入 handler 包以使用 ErrorResponse
	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// 定义每个IP的限流器存储
var (
	ipRateLimiters = make(map[string]*rate.Limiter)
	mu             sync.Mutex
)

// GetIPRateLimiter 获取指定IP的限流器，如果不存在则创建一个
func GetIPRateLimiter(ip string) *rate.Limiter {
	mu.Lock()
	defer mu.Unlock()
	limiter, exists := ipRateLimiters[ip]
	if !exists {
		// 每秒1次请求，突发量1
		limiter = rate.NewLimiter(rate.Every(time.Second), 1)
		ipRateLimiters[ip] = limiter
	}
	return limiter
}

// RateLimitMiddleware 是一个IP限流中间件
func RateLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		clientIP := c.ClientIP()
		limiter := GetIPRateLimiter(clientIP)

		if !limiter.Allow() {
			c.JSON(http.StatusTooManyRequests, handler.ErrorResponse{
				Message: "请求过于频繁，请稍后再试。",
				Code:    http.StatusTooManyRequests,
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

// JWTAuthMiddleware 是一个JWT认证中间件
func JWTAuthMiddleware(authService auth.Authenticator) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, handler.ErrorResponse{
				Message: "未提供认证令牌",
				Code:    http.StatusUnauthorized,
			})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if !(len(parts) == 2 && parts[0] == "Bearer") {
			c.JSON(http.StatusUnauthorized, handler.ErrorResponse{
				Message: "认证令牌格式错误，应为 'Bearer <token>'",
				Code:    http.StatusUnauthorized,
			})
			c.Abort()
			return
		}

		tokenString := parts[1]
		claims, err := authService.ParseToken(tokenString)
		if err != nil {
			statusCode := http.StatusUnauthorized
			if strings.Contains(err.Error(), "token无效") || strings.Contains(err.Error(), "签名无效") {
				statusCode = http.StatusUnauthorized
			}
			c.JSON(statusCode, handler.ErrorResponse{
				Message: fmt.Sprintf("无效的认证令牌: %s", err.Error()),
				Code:    statusCode,
			})
			c.Abort()
			return
		}

		// 将用户信息存储在Context中，以便后续处理函数使用
		c.Set("username", claims.Username)
		c.Next()
	}
}
