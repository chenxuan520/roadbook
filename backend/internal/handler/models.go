package handler

import (
	"encoding/json"
	"time"
)

// 通用响应结构
type ErrorResponse struct {
	Message string `json:"message"`
	Code    int    `json:"code,omitempty"`
}

// 认证模块
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token string `json:"token"`
}

// 计划管理
type CreatePlanRequest struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	StartTime   string          `json:"startTime"`
	EndTime     string          `json:"endTime"`
	Labels      []string        `json:"labels"`
	Content     json.RawMessage `json:"content"`
}

type CreatePlanResponse struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

type PlanSummary struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	CreatedAt   time.Time `json:"createdAt"`
	Description string    `json:"description"`
	StartTime   string    `json:"startTime"`
	EndTime     string    `json:"endTime"`
	Labels      []string  `json:"labels"`
}

type ListPlansResponse struct {
	Plans []PlanSummary `json:"plans"`
}

type Plan struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	CreatedAt   time.Time       `json:"createdAt"`
	Description string          `json:"description"`
	StartTime   string          `json:"startTime"`
	EndTime     string          `json:"endTime"`
	Labels      []string        `json:"labels"`
	Content     json.RawMessage `json:"content"`
}

type GetPlanResponse struct {
	Plan Plan `json:"plan"`
}

type SavePlanRequest struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	StartTime   string          `json:"startTime"`
	EndTime     string          `json:"endTime"`
	Labels      []string        `json:"labels"`
	Content     json.RawMessage `json:"content"`
}

type SavePlanResponse struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type DeletePlanResponse struct {
	Message string `json:"message"`
}
