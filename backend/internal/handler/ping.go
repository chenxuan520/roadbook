package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// 版本信息（通过 -ldflags -X 在构建时注入）
var (
	Version   = "unknown"
	Commit    = "unknown"
	BuildTime = "unknown"
)

// Ping 健康检查，返回 JSON 并携带版本信息
func Ping(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "pong",
		"version":   Version,
		"commit":    Commit,
		"buildTime": BuildTime,
	})
}
