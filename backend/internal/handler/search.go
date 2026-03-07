package handler

import (
	"net/http"

	"github.com/chenxuan520/roadmap/backend/internal/config"
	"github.com/chenxuan520/roadmap/backend/internal/search/baidu"
	"github.com/chenxuan520/roadmap/backend/internal/search/gaode"
	"github.com/chenxuan520/roadmap/backend/internal/search/tianmap"
	"github.com/gin-gonic/gin"
)

func GaodeSearchHandler(apiKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		query := c.Query("q")
		results, err := gaode.Search(query, apiKey)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, results)
	}
}

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

type ProviderStatus struct {
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
	Label   string `json:"label"`
}

func GetSearchProvidersHandler(cfg config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		providers := []ProviderStatus{
			{Name: "tianmap", Enabled: true, Label: "天地图"},
			{Name: "baidu", Enabled: true, Label: "百度"}, // baidu is hardcoded, so always "enabled" from backend pov
			{Name: "gaode", Enabled: cfg.Search.Providers.Gaode.Key != "", Label: "高德"},
		}
		c.JSON(http.StatusOK, providers)
	}
}
