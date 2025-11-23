package handler

import (
	"net/http"

	"github.com/chenxuan520/roadmap/backend/internal/auth"
	"github.com/gin-gonic/gin"
)

// AuthHandler 包含了认证相关的处理函数
type AuthHandler struct {
	authService auth.Authenticator
}

// NewAuthHandler 创建一个新的 AuthHandler 实例
func NewAuthHandler(authService auth.Authenticator) *AuthHandler {
	return &AuthHandler{
		authService: authService,
	}
}

// LoginHandler 处理用户登录请求
func (h *AuthHandler) LoginHandler(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Message: "请求参数错误",
			Code:    http.StatusBadRequest,
		})
		return
	}

	token, err := h.authService.Authenticate(req.Username, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, ErrorResponse{
			Message: err.Error(),
			Code:    http.StatusUnauthorized,
		})
		return
	}

	c.JSON(http.StatusOK, LoginResponse{Token: token})
}
