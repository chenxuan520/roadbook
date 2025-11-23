package handler

import (
	"net/http"

	"github.com/chenxuan520/roadmap/backend/internal/search/baidu"
	"github.com/chenxuan520/roadmap/backend/internal/search/tianmap"
	"github.com/gin-gonic/gin"
)

func BaiduSearchHandler(c *gin.Context) {
	query := c.Query("q")
	results, err := baidu.Search(query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, results)
}

func TianmapSearchHandler(c *gin.Context) {
	query := c.Query("q")
	results, err := tianmap.Search(query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, results)
}
