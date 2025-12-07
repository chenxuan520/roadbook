package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Ping is a simple health check handler.
func Ping(c *gin.Context) {
	c.String(http.StatusOK, "pong")
}
