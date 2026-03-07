package handler

import (
	"net/http"

	"github.com/chenxuan520/roadmap/backend/internal/config"
	"github.com/chenxuan520/roadmap/backend/internal/search/baidu"
	"github.com/chenxuan520/roadmap/backend/internal/search/gaode"
	"github.com/chenxuan520/roadmap/backend/internal/search/tianmap"
	"github.com/gin-gonic/gin"
)

// SearchHandlers holds dependencies for search-related handlers.
type SearchHandlers struct {
	cfg config.Config
}

// NewSearchHandlers creates a new instance of SearchHandlers.
func NewSearchHandlers(cfg config.Config) *SearchHandlers {
	return &SearchHandlers{cfg: cfg}
}

// GaodeSearchHandler handles Gaode search requests.
func (h *SearchHandlers) GaodeSearchHandler(c *gin.Context) {
	query := c.Query("q")
	results, err := gaode.Search(query, h.cfg.Search.Providers.Gaode.Key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, results)
}

// BaiduSearchHandler handles Baidu search requests.
func (h *SearchHandlers) BaiduSearchHandler(c *gin.Context) {
	query := c.Query("q")
	results, err := baidu.Search(query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, results)
}

// TianmapSearchHandler handles Tianmap search requests.
func (h *SearchHandlers) TianmapSearchHandler(c *gin.Context) {
	query := c.Query("q")
	results, err := tianmap.Search(query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, results)
}

type ProviderStatus struct {
	Name          string `json:"name"`
	Enabled       bool   `json:"enabled"`
	Label         string `json:"label"`
	LoginRequired bool   `json:"login_required"`
}

// GetSearchProvidersHandler handles requests for search provider status.
func (h *SearchHandlers) GetSearchProvidersHandler(c *gin.Context) {
	// NOTE: For providers like baidu and tianmap that don't have a login_required config yet,
	// the default value of a boolean in Go is false, which is the desired behavior.
	providers := []ProviderStatus{
		{Name: "tianmap", Enabled: true, Label: "天地图", LoginRequired: false},
		{Name: "baidu", Enabled: true, Label: "百度", LoginRequired: false},
		{
			Name:          "gaode",
			Enabled:       h.cfg.Search.Providers.Gaode.Key != "",
			Label:         "高德",
			LoginRequired: h.cfg.Search.Providers.Gaode.LoginRequired,
		},
	}
	c.JSON(http.StatusOK, providers)
}
