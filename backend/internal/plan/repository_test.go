package plan

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// setupTestEnv 创建测试目录，并返回清理函数
func setupTestEnv(t *testing.T) (Repository, func()) {
	// 创建一个临时数据目录，以避免与实际数据冲突
	tempDir, err := os.MkdirTemp("", "roadbook_test_data_")
	if err != nil {
		t.Fatalf("创建临时目录失败: %v", err)
	}

	// 临时修改 dataDir 全局变量，以指向测试目录
	originalDataDir := dataDir
	dataDir = tempDir

	repo, err := NewFileRepository() // 使用新的数据目录创建仓库
	if err != nil {
		os.RemoveAll(tempDir) // 清理临时目录
		t.Fatalf("创建仓库失败: %v", err)
	}

	return repo, func() {
		dataDir = originalDataDir // 恢复原始 dataDir
		os.RemoveAll(tempDir)     // 清理临时目录
	}
}

func TestFileRepository_SaveAndFind(t *testing.T) {
	repo, cleanup := setupTestEnv(t)
	defer cleanup()

	repo, err := NewFileRepository()
	if err != nil {
		t.Fatalf("创建仓库失败: %v", err)
	}

	// 创建一个新计划
	planContent := json.RawMessage(`{"waypoints": [{"lat": 10, "lon": 20}]}`)
	newPlan := &Plan{
		Name:        "测试计划1",
		Description: "这是一个测试计划",
		StartTime:   "20250101",
		EndTime:     "20250105",
		Labels:      []string{"测试", "旅行"},
		Content:     planContent,
	}

	err = repo.Save(newPlan)
	if err != nil {
		t.Fatalf("保存新计划失败: %v", err)
	}
	if newPlan.ID == "" {
		t.Error("新计划ID不应为空")
	}
	if newPlan.CreatedAt.IsZero() {
		t.Error("新计划CreatedAt不应为零值")
	}
	if newPlan.UpdatedAt.IsZero() {
		t.Error("新计划UpdatedAt不应为零值")
	}

	// 根据ID查找计划
	foundPlan, err := repo.FindByID(newPlan.ID)
	if err != nil {
		t.Fatalf("根据ID查找计划失败: %v", err)
	}
	if foundPlan.ID != newPlan.ID {
		t.Errorf("期望ID %s, 得到 %s", newPlan.ID, foundPlan.ID)
	}
	if foundPlan.Name != newPlan.Name {
		t.Errorf("期望名称 %s, 得到 %s", newPlan.Name, foundPlan.Name)
	}
	var newContentMap, foundContentMap map[string]interface{}
	json.Unmarshal(newPlan.Content, &newContentMap)
	json.Unmarshal(foundPlan.Content, &foundContentMap)
	if !reflect.DeepEqual(newContentMap, foundContentMap) {
		t.Errorf("期望内容 %s, 得到 %s", string(newPlan.Content), string(foundPlan.Content))
	}
	if foundPlan.StartTime != newPlan.StartTime {
		t.Errorf("期望开始时间 %s, 得到 %s", newPlan.StartTime, foundPlan.StartTime)
	}
	if foundPlan.EndTime != newPlan.EndTime {
		t.Errorf("期望结束时间 %s, 得到 %s", newPlan.EndTime, foundPlan.EndTime)
	}
	if len(foundPlan.Labels) != len(newPlan.Labels) || foundPlan.Labels[0] != newPlan.Labels[0] {
		t.Errorf("期望标签 %v, 得到 %v", newPlan.Labels, foundPlan.Labels)
	}

	// 更新计划
	foundPlan.Name = "更新后的测试计划"
	updatedContent := json.RawMessage(`{"waypoints": [{"lat": 30, "lon": 40}]}`)
	foundPlan.Content = updatedContent
	oldUpdatedAt := foundPlan.UpdatedAt
	time.Sleep(1 * time.Millisecond) // 确保更新时间不同

	err = repo.Save(foundPlan)
	if err != nil {
		t.Fatalf("更新计划失败: %v", err)
	}
	if foundPlan.UpdatedAt.Before(oldUpdatedAt) || foundPlan.UpdatedAt.Equal(oldUpdatedAt) {
		t.Error("更新后的UpdatedAt应该晚于旧的UpdatedAt")
	}

	// 重新查找并验证更新
	reFoundPlan, err := repo.FindByID(foundPlan.ID)
	if err != nil {
		t.Fatalf("重新查找更新后的计划失败: %v", err)
	}
	if reFoundPlan.Name != "更新后的测试计划" {
		t.Errorf("期望名称 '更新后的测试计划', 得到 %s", reFoundPlan.Name)
	}
	var updatedContentMap, reFoundContentMap map[string]interface{}
	json.Unmarshal(updatedContent, &updatedContentMap)
	json.Unmarshal(reFoundPlan.Content, &reFoundContentMap)
	if !reflect.DeepEqual(updatedContentMap, reFoundContentMap) {
		t.Errorf("期望内容 %s, 得到 %s", string(updatedContent), string(reFoundPlan.Content))
	}
}

func TestFileRepository_FindAll(t *testing.T) {
	repo, cleanup := setupTestEnv(t)
	defer cleanup()

	repo, err := NewFileRepository()
	if err != nil {
		t.Fatalf("创建仓库失败: %v", err)
	}

	planContent1 := json.RawMessage(`{}`)
	plan1 := &Plan{Name: "计划A", Description: "描述A", StartTime: "20250101", EndTime: "20250102", Labels: []string{"tag1"}, Content: planContent1}
	plan2 := &Plan{Name: "计划B", Description: "描述B", StartTime: "20250201", EndTime: "20250203", Labels: []string{"tag2"}, Content: planContent1}

	err = repo.Save(plan1)
	if err != nil {
		t.Fatalf("保存计划1失败: %v", err)
	}
	time.Sleep(1 * time.Millisecond) // 确保创建时间不同
	err = repo.Save(plan2)
	if err != nil {
		t.Fatalf("保存计划2失败: %v", err)
	}

	summaries, err := repo.FindAll()
	if err != nil {
		t.Fatalf("查找所有计划失败: %v", err)
	}

	if len(summaries) != 2 {
		t.Errorf("期望找到2个计划，得到 %d", len(summaries))
	}

	// 检查摘要内容
	foundA := false
	foundB := false
	for _, s := range summaries {
		if s.ID == plan1.ID && s.Name == plan1.Name && s.Description == plan1.Description && s.StartTime == plan1.StartTime && s.EndTime == plan1.EndTime && s.Labels[0] == plan1.Labels[0] {
			foundA = true
		}
		if s.ID == plan2.ID && s.Name == plan2.Name && s.Description == plan2.Description && s.StartTime == plan2.StartTime && s.EndTime == plan2.EndTime && s.Labels[0] == plan2.Labels[0] {
			foundB = true
		}
	}
	if !foundA || !foundB {
		t.Error("未找到所有预期的计划摘要")
	}
}

func TestFileRepository_Delete(t *testing.T) {
	repo, cleanup := setupTestEnv(t)
	defer cleanup()

	repo, err := NewFileRepository()
	if err != nil {
		t.Fatalf("创建仓库失败: %v", err)
	}

	planContent := json.RawMessage(`{}`)
	newPlan := &Plan{Name: "待删除计划", Description: "描述", StartTime: "20250101", EndTime: "20250102", Labels: []string{}, Content: planContent}
	err = repo.Save(newPlan)
	if err != nil {
		t.Fatalf("保存计划失败: %v", err)
	}

	err = repo.Delete(newPlan.ID)
	if err != nil {
		t.Fatalf("删除计划失败: %v", err)
	}

	// 验证计划是否已被删除
	_, err = repo.FindByID(newPlan.ID)
	if err == nil {
		t.Error("期望计划已被删除，但仍然找到")
	}
	expectedErr := fmt.Sprintf("计划 %s 未找到", newPlan.ID)
	if err.Error() != expectedErr {
		t.Errorf("期望错误消息 '%s', 得到 '%s'", expectedErr, err.Error())
	}

	// 尝试删除一个不存在的计划
	err = repo.Delete("non-existent-id")
	if err == nil {
		t.Error("期望删除不存在计划时返回错误，但未返回")
	}
	expectedErrNotFound := "计划 non-existent-id 未找到，无法删除"
	if err.Error() != expectedErrNotFound {
		t.Errorf("期望错误消息 '%s', 得到 '%s'", expectedErrNotFound, err.Error())
	}
}

func TestFileRepository_FindByID_NotFound(t *testing.T) {
	repo, cleanup := setupTestEnv(t)
	defer cleanup()

	repo, err := NewFileRepository()
	if err != nil {
		t.Fatalf("创建仓库失败: %v", err)
	}

	_, err = repo.FindByID("non-existent-id")
	if err == nil {
		t.Error("期望查找不存在计划时返回错误，但未返回")
	}
	expectedErr := "计划 non-existent-id 未找到"
	if err.Error() != expectedErr {
		t.Errorf("期望错误消息 '%s', 得到 '%s'", expectedErr, err.Error())
	}
}

func TestFileRepository_NewFileRepository_DirExists(t *testing.T) {
	// setupTestEnv会创建临时目录，并尝试创建NewFileRepository
	_, cleanup := setupTestEnv(t)
	defer cleanup()

	// 再次调用NewFileRepository应该不会报错，因为目录已经存在
	_, err := NewFileRepository()
	if err != nil {
		t.Fatalf("期望当数据目录已存在时再次创建仓库成功，但失败: %v", err)
	}
}

func TestFileRepository_FindAll_CorruptedFile(t *testing.T) {
	_, cleanup := setupTestEnv(t)
	defer cleanup()

	repo, err := NewFileRepository()
	if err != nil {
		t.Fatalf("创建仓库失败: %v", err)
	}

	// 写入一个有效计划
	validPlan := &Plan{ID: "valid-plan", Name: "Valid Plan", Description: "Valid", CreatedAt: time.Now().UTC(), Content: json.RawMessage(`{}`)}
	filepath.Join(dataDir, validPlan.ID+fileExt) // Ensure dataDir is correctly set for test
	err = repo.Save(validPlan)
	if err != nil {
		t.Fatalf("保存有效计划失败: %v", err)
	}

	// 写入一个损坏的计划文件
	corruptedFilePath := filepath.Join(dataDir, "corrupted-plan.json")
	err = os.WriteFile(corruptedFilePath, []byte("{invalid json"), 0644)
	if err != nil {
		t.Fatalf("写入损坏文件失败: %v", err)
	}

	summaries, err := repo.FindAll()
	if err != nil {
		t.Fatalf("期望FindAll能跳过损坏文件，但返回错误: %v", err)
	}

	if len(summaries) != 1 {
		t.Errorf("期望找到1个有效计划，得到 %d", len(summaries))
	}
	if summaries[0].ID != "valid-plan" {
		t.Errorf("期望找到的计划ID是 'valid-plan', 得到 '%s'", summaries[0].ID)
	}
}
