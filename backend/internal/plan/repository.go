package plan

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid" // 使用 uuid 生成唯一ID
)

var (
	dataDir = "data" // 计划文件存储目录
	fileExt = ".json"
)

// Repository 定义了计划存储的接口
type Repository interface {
	Save(plan *Plan) error
	FindByID(id string) (*Plan, error)
	FindAll() ([]PlanSummary, error)
	Delete(id string) error
}

// fileRepository 是 Repository 接口的文件系统实现
type fileRepository struct {
	mu sync.RWMutex // 用于并发访问文件系统的读写锁
}

// NewFileRepository 创建一个新的 fileRepository 实例
func NewFileRepository() (Repository, error) {
	if _, err := os.Stat(dataDir); os.IsNotExist(err) {
		err := os.Mkdir(dataDir, 0755)
		if err != nil {
			return nil, fmt.Errorf("创建数据目录失败: %w", err)
		}
	}
	return &fileRepository{}, nil
}

// Save 保存一个计划。如果计划ID为空，则生成新的ID并设置创建时间；否则更新计划。
func (r *fileRepository) Save(plan *Plan) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if plan.ID == "" {
		plan.ID = uuid.New().String()
		plan.CreatedAt = time.Now().UTC()
	} else {
		// 防御路径遍历攻击
		if filepath.Base(plan.ID) != plan.ID {
			return fmt.Errorf("无效的计划ID: %s", plan.ID)
		}
	}
	plan.UpdatedAt = time.Now().UTC() // 每次保存都更新UpdatedAt

	filePath := filepath.Join(dataDir, plan.ID+fileExt)
	data, err := json.MarshalIndent(plan, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化计划失败: %w", err)
	}

	err = ioutil.WriteFile(filePath, data, 0644)
	if err != nil {
		return fmt.Errorf("写入计划文件失败: %w", err)
	}
	return nil
}

// FindByID 根据ID查找并返回一个计划
func (r *fileRepository) FindByID(id string) (*Plan, error) {
	// 防御路径遍历攻击
	if filepath.Base(id) != id {
		return nil, fmt.Errorf("无效的计划ID: %s", id)
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	filePath := filepath.Join(dataDir, id+fileExt)
	data, err := ioutil.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("计划 %s 未找到", id)
		}
		return nil, fmt.Errorf("读取计划文件 %s 失败: %w", id, err)
	}

	var plan Plan
	err = json.Unmarshal(data, &plan)
	if err != nil {
		return nil, fmt.Errorf("反序列化计划文件 %s 失败: %w", id, err)
	}
	return &plan, nil
}

// FindAll 查找并返回所有计划的摘要信息
func (r *fileRepository) FindAll() ([]PlanSummary, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	files, err := ioutil.ReadDir(dataDir)
	if err != nil {
		return nil, fmt.Errorf("读取数据目录失败: %w", err)
	}

	var summaries []PlanSummary
	for _, file := range files {
		if file.IsDir() || filepath.Ext(file.Name()) != fileExt {
			continue
		}

		// id := file.Name()[:len(file.Name())-len(fileExt)] // 变量id在此处未使用，已注释或删除
		filePath := filepath.Join(dataDir, file.Name())

		data, err := ioutil.ReadFile(filePath)
		if err != nil {
			// 如果单个文件读取失败，记录错误并跳过，不影响其他计划
			log.Printf("警告: 读取计划文件 %s 失败: %v\n", file.Name(), err)
			continue
		}

		var plan Plan
		err = json.Unmarshal(data, &plan)
		if err != nil {
			log.Printf("警告: 反序列化计划文件 %s 失败: %v\n", file.Name(), err)
			continue
		}

		summaries = append(summaries, PlanSummary{
			ID:          plan.ID,
			Name:        plan.Name,
			Description: plan.Description,
			StartTime:   plan.StartTime,
			EndTime:     plan.EndTime,
			Labels:      plan.Labels,
			CreatedAt:   plan.CreatedAt,
		})
	}
	return summaries, nil
}

// Delete 根据ID删除一个计划
func (r *fileRepository) Delete(id string) error {
	// 防御路径遍历攻击
	if filepath.Base(id) != id {
		return fmt.Errorf("无效的计划ID: %s", id)
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	filePath := filepath.Join(dataDir, id+fileExt)
	err := os.Remove(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("计划 %s 未找到，无法删除", id)
		}
		return fmt.Errorf("删除计划文件 %s 失败: %w", id, err)
	}
	return nil
}
