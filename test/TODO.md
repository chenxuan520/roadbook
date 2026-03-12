# 前端测试待办（后续补充）

说明：以下内容以“前端可编辑模式（非移动端）+ 不依赖后端接口”为前提。

## 待补测试用例

- [ ] **导入版本兼容提示**：覆盖 `compareVersions` 相关分支，验证低版本/高版本导入时的提示与行为是否符合预期。
- [ ] **连接线起点/终点改选**：在连接线详情面板内修改 `#connectionStartMarker/#connectionEndMarker`，验证：
  - 连接线对应的 `startId/endId/startTitle/endTitle` 更新
  - 线条/箭头/图标位置与颜色重绘正确
  - 本地缓存（`localStorage.roadbookData`）同步正确
- [ ] **筛选模式下便签链接点击**：`#dateNotesSticky` 中包含 `<a>` 链接时，点击链接不应触发“退出筛选模式”。
- [ ] **搜索临时点行为**：
  - 选择搜索结果后创建 `searchMarker`（临时点）
  - 点击临时点会 `setView(..., 15)` 聚焦
  - 3 秒后自动关闭 popup（可通过 fake timers / poll 验证）

