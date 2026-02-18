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

// RefreshHandler 处理 token 续约请求（需要JWT认证）
// 通过中间件解析后的 username 重新签发一个新的 token（延长有效期）
func (h *AuthHandler) RefreshHandler(c *gin.Context) {
	usernameAny, ok := c.Get("username")
	if !ok {
		c.JSON(http.StatusUnauthorized, ErrorResponse{
			Message: "未提供认证信息",
			Code:    http.StatusUnauthorized,
		})
		return
	}

	username, _ := usernameAny.(string)
	if username == "" {
		c.JSON(http.StatusUnauthorized, ErrorResponse{
			Message: "未提供认证信息",
			Code:    http.StatusUnauthorized,
		})
		return
	}

	token, err := h.authService.GenerateToken(username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{
			Message: "生成续约token失败",
			Code:    http.StatusInternalServerError,
		})
		return
	}

	c.JSON(http.StatusOK, LoginResponse{Token: token})
}
