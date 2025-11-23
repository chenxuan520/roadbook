package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/chenxuan520/roadmap/backend/internal/config" // 导入 config 包
	jwt "github.com/dgrijalva/jwt-go"                         // 注意这里使用了 v3.2.0 的 jwt-go
)

// Claims 定义了JWT中包含的用户信息
type Claims struct {
	Username string `json:"username"`
	jwt.StandardClaims
}

// Authenticator 定义了认证服务的接口
type Authenticator interface {
	Authenticate(username, password string) (string, error)
	GenerateToken(username string) (string, error)
	ParseToken(tokenString string) (*Claims, error)
}

// service 结构体包含 JWT 密钥和用户列表
type service struct {
	jwtSecret []byte
	users     map[string]string
}

// NewService 创建并返回一个认证服务实例
func NewService(cfg config.Config) Authenticator {
	return &service{
		jwtSecret: []byte(cfg.JwtSecret),
		users:     cfg.Users,
	}
}

// Authenticate 验证用户凭证并生成JWT token
func (s *service) Authenticate(username, password string) (string, error) {
	if pwd, ok := s.users[username]; !ok || pwd != password {
		return "", errors.New("无效的用户名或密码")
	}
	return s.GenerateToken(username)
}

// GenerateToken 为指定用户生成JWT token
func (s *service) GenerateToken(username string) (string, error) {
	expirationTime := time.Now().Add(24 * time.Hour) // Token 24小时过期
	claims := &Claims{
		Username: username,
		StandardClaims: jwt.StandardClaims{
			ExpiresAt: expirationTime.Unix(),
			IssuedAt:  time.Now().Unix(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(s.jwtSecret) // 使用 service 中的 jwtSecret
	if err != nil {
		return "", fmt.Errorf("生成JWT token失败: %w", err)
	}
	return tokenString, nil
}

// ParseToken 解析JWT token字符串并返回Claims
func (s *service) ParseToken(tokenString string) (*Claims, error) {
	claims := &Claims{}

	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("非预期的签名方法: %v", token.Header["alg"])
		}
		return s.jwtSecret, nil // 使用 service 中的 jwtSecret
	})

	if err != nil {
		if err == jwt.ErrSignatureInvalid {
			return nil, errors.New("JWT签名无效")
		}
		return nil, fmt.Errorf("解析JWT token失败: %w", err)
	}

	if !token.Valid {
		return nil, errors.New("JWT token无效")
	}

	return claims, nil
}