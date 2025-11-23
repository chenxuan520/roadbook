package plan

import (
	"encoding/json"
	"time"
)

// Plan 定义了路书计划的完整结构，用于内部存储和业务逻辑。
type Plan struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	StartTime   string          `json:"startTime"` // 格式 YYYYMMDD
	EndTime     string          `json:"endTime"`   // 格式 YYYYMMDD
	Labels      []string        `json:"labels"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"` // 新增字段，用于记录更新时间
	Content     json.RawMessage `json:"content"`
}

// PlanSummary 定义了计划的摘要信息，用于列表展示。
type PlanSummary struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	StartTime   string    `json:"startTime"` // 格式 YYYYMMDD
	EndTime     string    `json:"endTime"`   // 格式 YYYYMMDD
	Labels      []string  `json:"labels"`
	CreatedAt   time.Time `json:"createdAt"`
}
