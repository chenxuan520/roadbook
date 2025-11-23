package handler

import (
	"fmt" // 新增导入
	"net/http"
	"time"

	"github.com/chenxuan520/roadmap/backend/internal/plan"
	"github.com/gin-gonic/gin"
)

// PlanHandler 包含了计划相关的处理函数
type PlanHandler struct {
	planRepo plan.Repository
}

// NewPlanHandler 创建一个新的 PlanHandler 实例
func NewPlanHandler(planRepo plan.Repository) *PlanHandler {
	return &PlanHandler{
		planRepo: planRepo,
	}
}

// convertPlanToHandlerPlan 将 internal/plan.Plan 转换为 internal/handler.Plan
func convertPlanToHandlerPlan(p *plan.Plan) Plan {
	return Plan{
		ID:          p.ID,
		Name:        p.Name,
		CreatedAt:   p.CreatedAt,
		Description: p.Description,
		StartTime:   p.StartTime,
		EndTime:     p.EndTime,
		Labels:      p.Labels,
		Content:     p.Content,
	}
}

// CreatePlanHandler 处理创建计划的请求
func (h *PlanHandler) CreatePlanHandler(c *gin.Context) {
	var req CreatePlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Message: "请求参数错误: " + err.Error(),
			Code:    http.StatusBadRequest,
		})
		return
	}

	newPlan := &plan.Plan{
		Name:        req.Name,
		Description: req.Description,
		StartTime:   req.StartTime,
		EndTime:     req.EndTime,
		Labels:      req.Labels,
		Content:     req.Content,
	}

	if err := h.planRepo.Save(newPlan); err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{
			Message: "创建计划失败: " + err.Error(),
			Code:    http.StatusInternalServerError,
		})
		return
	}

	c.JSON(http.StatusCreated, CreatePlanResponse{
		ID:        newPlan.ID,
		Name:      newPlan.Name,
		CreatedAt: newPlan.CreatedAt,
	})
}

// ListPlansHandler 处理列出所有计划的请求
func (h *PlanHandler) ListPlansHandler(c *gin.Context) {
	summaries, err := h.planRepo.FindAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{
			Message: "获取计划列表失败: " + err.Error(),
			Code:    http.StatusInternalServerError,
		})
		return
	}

	// 将 internal/plan.PlanSummary 转换为 internal/handler.PlanSummary
	handlerSummaries := make([]PlanSummary, len(summaries))
	for i, ps := range summaries {
		handlerSummaries[i] = PlanSummary{
			ID:          ps.ID,
			Name:        ps.Name,
			CreatedAt:   ps.CreatedAt,
			Description: ps.Description,
			StartTime:   ps.StartTime,
			EndTime:     ps.EndTime,
			Labels:      ps.Labels,
		}
	}

	c.JSON(http.StatusOK, ListPlansResponse{Plans: handlerSummaries})
}

// GetPlanHandler 处理获取指定计划的请求
func (h *PlanHandler) GetPlanHandler(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Message: "计划ID不能为空",
			Code:    http.StatusBadRequest,
		})
		return
	}

	p, err := h.planRepo.FindByID(id)
	if err != nil {
		statusCode := http.StatusInternalServerError
		if err.Error() == fmt.Sprintf("计划 %s 未找到", id) { // 检查是否是“未找到”的错误
			statusCode = http.StatusNotFound
		}
		c.JSON(statusCode, ErrorResponse{
			Message: "获取计划失败: " + err.Error(),
			Code:    statusCode,
		})
		return
	}

	c.JSON(http.StatusOK, GetPlanResponse{
		Plan: convertPlanToHandlerPlan(p),
	})
}

// SavePlanHandler 处理更新/保存计划的请求
func (h *PlanHandler) SavePlanHandler(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Message: "计划ID不能为空",
			Code:    http.StatusBadRequest,
		})
		return
	}

	var req SavePlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Message: "请求参数错误: " + err.Error(),
			Code:    http.StatusBadRequest,
		})
		return
	}

	// 尝试获取现有计划，如果不存在则报错
	existingPlan, err := h.planRepo.FindByID(id)
	if err != nil {
		if err.Error() == fmt.Sprintf("计划 %s 未找到", id) {
			c.JSON(http.StatusNotFound, ErrorResponse{
				Message: "要更新的计划未找到",
				Code:    http.StatusNotFound,
			})
		} else {
			c.JSON(http.StatusInternalServerError, ErrorResponse{
				Message: "获取现有计划失败: " + err.Error(),
				Code:    http.StatusInternalServerError,
			})
		}
		return
	}

	// 更新计划内容
	existingPlan.Name = req.Name
	existingPlan.Description = req.Description
	existingPlan.StartTime = req.StartTime
	existingPlan.EndTime = req.EndTime
	existingPlan.Labels = req.Labels
	existingPlan.Content = req.Content
	existingPlan.UpdatedAt = time.Now().UTC() // 确保更新时间

	if err := h.planRepo.Save(existingPlan); err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{
			Message: "保存计划失败: " + err.Error(),
			Code:    http.StatusInternalServerError,
		})
		return
	}

	c.JSON(http.StatusOK, SavePlanResponse{
		ID:        existingPlan.ID,
		Name:      existingPlan.Name,
		UpdatedAt: existingPlan.UpdatedAt,
	})
}

// DeletePlanHandler 处理删除计划的请求
func (h *PlanHandler) DeletePlanHandler(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Message: "计划ID不能为空",
			Code:    http.StatusBadRequest,
		})
		return
	}

	err := h.planRepo.Delete(id)
	if err != nil {
		statusCode := http.StatusInternalServerError
		if err.Error() == fmt.Sprintf("计划 %s 未找到，无法删除", id) { // 检查是否是“未找到”的错误
			statusCode = http.StatusNotFound
		}
		c.JSON(statusCode, ErrorResponse{
			Message: "删除计划失败: " + err.Error(),
			Code:    statusCode,
		})
		return
	}

	c.JSON(http.StatusOK, DeletePlanResponse{
		Message: fmt.Sprintf("计划 %s 删除成功", id),
	})
}

// SharePlanHandler 处理分享计划的请求（无需认证）
func (h *PlanHandler) SharePlanHandler(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Message: "计划ID不能为空",
			Code:    http.StatusBadRequest,
		})
		return
	}

	p, err := h.planRepo.FindByID(id)
	if err != nil {
		statusCode := http.StatusInternalServerError
		if err.Error() == fmt.Sprintf("计划 %s 未找到", id) {
			statusCode = http.StatusNotFound
		}
		c.JSON(statusCode, ErrorResponse{
			Message: "获取分享计划失败: " + err.Error(),
			Code:    statusCode,
		})
		return
	}

	c.JSON(http.StatusOK, GetPlanResponse{
		Plan: convertPlanToHandlerPlan(p),
	})
}
