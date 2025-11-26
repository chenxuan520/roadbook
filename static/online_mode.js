// 在线模式功能实现
class OnlineModeManager {
    constructor(app) {
        this.app = app;
        this.mode = 'offline'; // 默认离线模式
        this.token = localStorage.getItem('online_token') || null;
        this.currentPlanId = null;
        this.currentPlanName = null;
        this.lastSavedHash = null; // 最后保存的内容哈希
        this.contentCheckInterval = null; // 内容检查定时器
        this.initialize();
        this.restoreState(); // 初始化后恢复状态
    }

    initialize() {
        // 创建在线模式选择下拉框
        this.createModeSelector();

        // 检查当前是否有有效token，如果有则更新UI状态
        if (this.token) {
            this.checkTokenValidity();
        }
    }

    // 保存当前状态到本地缓存
    saveState() {
        const state = {
            mode: this.mode,
            currentPlanId: this.currentPlanId,
            currentPlanName: this.currentPlanName,
            lastSavedHash: this.lastSavedHash, // 保存内容哈希
            timestamp: Date.now() // 添加时间戳，用于过期检查（可选）
        };
        localStorage.setItem('online_mode_state', JSON.stringify(state));
    }

    // 从本地缓存恢复状态
    restoreState() {
        try {
            const stateStr = localStorage.getItem('online_mode_state');
            if (stateStr) {
                const state = JSON.parse(stateStr);

                // 恢复模式状态
                if (state.mode) {
                    this.mode = state.mode;
                }

                // 恢复计划信息
                if (state.currentPlanId) {
                    this.currentPlanId = state.currentPlanId;
                    this.currentPlanName = state.currentPlanName;
                }

                // 恢复内容哈希
                if (state.lastSavedHash) {
                    this.lastSavedHash = state.lastSavedHash;
                }

                // 更新UI以匹配恢复的状态
                this.updateUIForMode(this.mode);

                // 如果有当前计划且处于在线模式，显示编辑指示器
                if (this.currentPlanId && this.mode === 'online') {
                    this.showEditingIndicator(this.currentPlanName || '未命名计划');
                }
            }
        } catch (error) {
            console.error('恢复在线模式状态失败:', error);
            // 如果解析失败，清除损坏的状态数据
            localStorage.removeItem('online_mode_state');
        }
    }

    // 清除本地缓存中的状态
    clearState() {
        localStorage.removeItem('online_mode_state');
    }

    // 创建模式选择下拉框
    createModeSelector() {
        const searchMethodSelect = document.getElementById('searchMethodSelect');
        if (!searchMethodSelect) return;

        const modeSelectorContainer = document.createElement('div');
        modeSelectorContainer.className = 'mode-selector-container';
        modeSelectorContainer.innerHTML = `
            <select id="modeSelector" class="btn" style="background: linear-gradient(135deg, rgba(255,255,255,0.3), rgba(255,255,255,0.15)); color: #fff; border: 2px solid rgba(255,255,255,0.5); padding: 0.6rem 1.2rem; border-radius: 25px; font-size: 0.9rem; font-weight: 600; cursor: pointer; margin-left: 0.5rem;">
                <option value="offline">离线模式</option>
                <option value="online">在线模式</option>
            </select>
        `;

        // 在搜索模式选择框后面插入模式选择器
        searchMethodSelect.parentNode.insertBefore(modeSelectorContainer, searchMethodSelect.nextSibling);

        // 绑定切换事件
        const modeSelector = document.getElementById('modeSelector');
        if (modeSelector) {
            modeSelector.value = this.mode;
            modeSelector.addEventListener('change', (e) => {
                this.setMode(e.target.value);
            });
        }
    }

    // 设置当前模式
    setMode(mode) {
        if (mode === 'online' && !this.token) {
            // 如果切换到在线模式但没有token，显示登录弹窗
            this.showLoginModal();
        } else {
            this.mode = mode;
            this.updateUIForMode(mode);
            this.saveState(); // 保存状态

            // 如果切换到在线模式且已登录，显示管理界面
            if (mode === 'online' && this.token) {
                this.showPlanManager();
            }
        }
    }

    // 更新UI以适应当前模式
    updateUIForMode(mode) {
        const modeSelector = document.getElementById('modeSelector');
        if (modeSelector) {
            modeSelector.value = mode;
        }

        // 显示或隐藏保存按钮
        this.toggleSaveButton(mode === 'online');

        // 显示或隐藏分享按钮（在在线模式下显示）
        this.toggleShareButton(mode === 'online');

        // 如果退出在线模式，清空当前计划信息
        if (mode !== 'online') {
            this.currentPlanId = null;
            this.currentPlanName = null;
            this.lastSavedHash = null;
            this.hideEditingIndicator();
        }
    }

    // 切换保存按钮显示
    toggleSaveButton(show) {
        const onlineModeActions = document.getElementById('onlineModeActions');
        if (!onlineModeActions) return;

        let saveButton = document.getElementById('cloudSaveBtn');
        let settingsButton = document.getElementById('cloudSettingsBtn');
        let logoutButton = document.getElementById('cloudLogoutBtn');

        if (show) {
            if (!saveButton) {
                saveButton = document.createElement('button');
                saveButton.id = 'cloudSaveBtn';
                saveButton.className = 'btn';
                saveButton.innerHTML = '<span class="icon">💾</span><span>云端保存</span>'; // 添加图标和文本
                saveButton.addEventListener('click', () => {
                    this.saveToCloud();
                });
                onlineModeActions.appendChild(saveButton);
            }

            if (!settingsButton) {
                settingsButton = document.createElement('button');
                settingsButton.id = 'cloudSettingsBtn';
                settingsButton.className = 'btn';
                settingsButton.innerHTML = '<span class="icon">⚙️</span><span>管理</span>'; // 设置图标和文本
                settingsButton.addEventListener('click', () => {
                    this.showPlanManager(); // 点击打开计划管理界面
                });
                onlineModeActions.appendChild(settingsButton);
            }

            if (!logoutButton) {
                logoutButton = document.createElement('button');
                logoutButton.id = 'cloudLogoutBtn';
                logoutButton.className = 'btn';
                logoutButton.innerHTML = '<span class="icon">🚪</span><span>退出登录</span>'; // 退出登录图标和文本
                logoutButton.addEventListener('click', () => {
                    this.logout(); // 点击执行退出登录操作
                });
                onlineModeActions.appendChild(logoutButton);
            }
            onlineModeActions.style.display = 'flex'; // 显示容器
        } else {
            if (saveButton) {
                saveButton.remove();
            }
            if (settingsButton) {
                settingsButton.remove();
            }
            if (logoutButton) {
                logoutButton.remove();
            }
            // 如果onlineModeActions中没有其他子元素，则隐藏它
            if (onlineModeActions.children.length === 0) {
                onlineModeActions.style.display = 'none';
            }
        }
    }

    // 切换分享按钮显示
    toggleShareButton(show) {
        const onlineModeActions = document.getElementById('onlineModeActions');
        if (!onlineModeActions) return;

        let shareButton = document.getElementById('shareBtn');

        if (show) {
            if (!shareButton) {
                shareButton = document.createElement('button');
                shareButton.id = 'shareBtn';
                shareButton.className = 'btn';
                shareButton.innerHTML = '<span class="icon">🔗</span><span>分享</span>'; // 分享图标和文本
                shareButton.addEventListener('click', () => {
                    this.generateShareLink();
                });
                onlineModeActions.appendChild(shareButton);
            }
        } else {
            if (shareButton) {
                shareButton.remove();
            }
        }
    }

    // 生成分享链接
    async generateShareLink() {
        if (!this.currentPlanId) {
            this.showSwalAlert('提示', '当前没有打开的计划，请先打开或创建一个计划', 'warning');
            return;
        }

        try {
            // 首先保存当前计划到云端，确保分享的是最新内容
            await this.saveToCloud();

            // 生成分享链接
            const baseUrl = window.location.origin + window.location.pathname;
            const shareUrl = `${baseUrl}?shareID=${this.currentPlanId}`;

            // 显示分享链接对话框
            this.showShareLinkDialog(shareUrl);
        } catch (error) {
            console.error('生成分享链接失败:', error);
            this.showSwalAlert('错误', '生成分享链接失败: ' + error.message, 'error');
        }
    }

    // 显示分享链接对话框
    showShareLinkDialog(shareUrl) {
        // 创建分享链接弹窗
        let shareModal = document.getElementById('shareModal');
        if (shareModal) {
            shareModal.remove();
        }

        shareModal = document.createElement('div');
        shareModal.id = 'shareModal';
        shareModal.className = 'modal';
        shareModal.innerHTML = `
            <div class="modal-content" style="width: 500px; max-width: 90vw;">
                <span class="close" id="closeShareModal">&times;</span>
                <h3>分享计划</h3>
                <div class="form-group">
                    <label>分享链接:</label>
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="shareLinkInput" value="${shareUrl}" readonly
                               style="flex: 1; padding: 0.8rem; border: 2px solid #e1e5e9; border-radius: 8px; font-size: 0.9rem;">
                        <button id="copyShareLinkBtn" class="btn" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 0.8rem 1.2rem; border-radius: 8px; cursor: pointer;">复制</button>
                    </div>
                </div>
                <div class="form-group">
                    <p style="color: #666; font-size: 0.9rem; margin: 0;">
                        任何人都可以通过此链接查看您的计划，无需登录。
                    </p>
                </div>
                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                    <button id="closeShareBtn" class="btn" style="background: #ccc; color: #333; border: none; padding: 0.6rem 1.2rem; border-radius: 8px; cursor: pointer;">关闭</button>
                </div>
            </div>
        `;
        document.body.appendChild(shareModal);

        // 绑定事件
        document.getElementById('closeShareModal').addEventListener('click', () => {
            shareModal.remove();
        });

        document.getElementById('closeShareBtn').addEventListener('click', () => {
            shareModal.remove();
        });

        // 点击弹窗外部区域也关闭弹窗
        shareModal.addEventListener('click', (e) => {
            if (e.target === shareModal) {
                shareModal.remove();
            }
        });

        // 复制链接功能
        document.getElementById('copyShareLinkBtn').addEventListener('click', async () => {
            const shareLinkInput = document.getElementById('shareLinkInput');
            try {
                await navigator.clipboard.writeText(shareLinkInput.value);
                this.showSwalAlert('成功', '分享链接已复制到剪贴板！', 'success', 'top-end');
            } catch (err) {
                this.showSwalAlert('提示', '请手动复制链接', 'info');
            }
        });

        shareModal.style.display = 'block';
    }

    // 显示登录弹窗
    showLoginModal() {
        // 检查是否已存在弹窗
        let modal = document.getElementById('loginModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'loginModal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="width: 400px;">
                    <span class="close" id="closeLoginModal">&times;</span>
                    <h3>在线模式登录</h3>
                    <form id="loginForm">
                        <div class="form-group">
                            <label>账号:</label>
                            <input type="text" id="loginUsername" class="login-input" placeholder="请输入账号" required>
                        </div>
                        <div class="form-group">
                            <label>密码:</label>
                            <input type="password" id="loginPassword" class="login-input" placeholder="请输入密码" required>
                        </div>
                        <button type="submit" class="btn login-btn">登录</button>
                    </form>
                </div>
            `;
            document.body.appendChild(modal);

            // 阻止键盘事件冒泡，防止干扰原始键盘事件处理
            const loginInputs = modal.querySelectorAll('input');
            loginInputs.forEach(input => {
                input.addEventListener('keydown', (e) => {
                    // 阻止键盘事件冒泡，避免触发原始的键盘快捷键处理
                    e.stopPropagation();
                });
            });

            // 绑定事件
            document.getElementById('closeLoginModal').addEventListener('click', () => {
                this.closeLoginModal();
            });

            // 点击弹窗外部区域也关闭弹窗并切换回离线模式
            const modalElement = document.getElementById('loginModal');
            if (modalElement) {
                modalElement.addEventListener('click', (e) => {
                    if (e.target === modalElement) {
                        this.closeLoginModal();
                    }
                });
            }

            document.getElementById('loginForm').addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }

        modal.style.display = 'block';

        // 当模态框显示时，防止原始键盘事件处理程序捕获键盘事件
        modal.addEventListener('keydown', (e) => {
            // 阻止所有键盘事件冒泡，这样原始的键盘快捷键处理程序就无法捕获这些事件
            e.stopPropagation();
        });
    }

    // 关闭登录弹窗
    closeLoginModal() {
        const modal = document.getElementById('loginModal');
        if (modal) {
            modal.style.display = 'none';
        }

        // 关闭登录弹窗时切换回离线模式
        this.mode = 'offline';
        const modeSelector = document.getElementById('modeSelector');
        if (modeSelector) {
            modeSelector.value = 'offline';
        }
        this.updateUIForMode('offline');
        this.saveState(); // 保存状态
    }

    // 处理登录请求
    async handleLogin() {
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value.trim();

        if (!username || !password) {
            this.showSwalAlert('输入错误', '请输入账号和密码', 'warning');
            return;
        }

        try {
            const response = await this.makeApiRequest('/login', 'POST', {
                username,
                password
            });

            if (response.token) {
                this.token = response.token;
                localStorage.setItem('online_token', response.token);

                // 登录成功后关闭弹窗并切换到在线模式
                this.closeLoginModal();
                this.mode = 'online';
                this.updateUIForMode('online');

                // 显示计划管理界面
                this.showPlanManager();
            } else {
                this.showSwalAlert('登录失败', response.message || '未知错误', 'error');
                // 登录失败时切换回离线模式
                this.mode = 'offline';
                this.updateUIForMode('offline');
                this.saveState(); // 保存状态
            }
        } catch (error) {
            console.error('登录错误:', error);
            this.showSwalAlert('登录失败', error.message, 'error');
            // 登录失败时切换回离线模式
            this.mode = 'offline';
            this.updateUIForMode('offline');
            this.saveState(); // 保存状态
        }
    }

    // 退出登录
    async logout() {
        const result = await this.showSwalConfirm('退出登录', '确定要退出登录吗？退出后将切换到离线模式。', '确定', '取消');
        if (!result.isConfirmed) {
            return;
        }

        // 清除token
        this.token = null;
        localStorage.removeItem('online_token');

        // 清除当前计划信息
        this.currentPlanId = null;
        this.currentPlanName = null;

        // 清除本地状态
        this.clearState();

        // 切换到离线模式
        this.mode = 'offline';
        this.updateUIForMode('offline');

        // 更新模式选择器UI
        const modeSelector = document.getElementById('modeSelector');
        if (modeSelector) {
            modeSelector.value = 'offline';
        }

        // 重新加载页面数据，可能需要清空当前应用数据
        this.app.loadFromLocalStorage(); // 重新加载本地数据

        this.showSwalAlert('退出登录', '已退出登录，切换到离线模式', 'info');
    }

    // 检查token有效性
    async checkTokenValidity() {
        try {
            const response = await this.makeApiRequest('/plans', 'GET');

            // 如果能成功获取计划列表，说明token有效
            if (response.plans !== undefined) {
                console.log('Token 验证成功');
            } else {
                // token可能无效，清除本地token
                this.token = null;
                localStorage.removeItem('online_token');
            }
        } catch (error) {
            console.error('Token 验证失败:', error);
            this.token = null;
            localStorage.removeItem('online_token');
            this.clearState(); // 清除状态
        }
    }

    // 显示计划管理界面
    showPlanManager() {
        // 检查是否已存在管理界面
        let manager = document.getElementById('planManager');
        if (!manager) {
            manager = document.createElement('div');
            manager.id = 'planManager';
            manager.className = 'modal';
            manager.innerHTML = `
                <div class="modal-content" style="width: 800px; max-width: 90vw; height: 70vh; max-height: 80vh; background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(240,240,240,0.95)); backdrop-filter: blur(10px); box-shadow: 0 10px 40px rgba(0,0,0,0.3); margin: 3% auto;">
                    <span class="close" id="closePlanManager" style="position: absolute; right: 15px; top: 15px; z-index: 1001; font-size: 30px; color: #667eea; cursor: pointer;">&times;</span>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem 0 1.5rem;">
                        <h3 style="margin: 0; color: #333; font-size: 1.4rem;">计划管理</h3>
                        <div style="flex: 1; max-width: 300px; margin-left: 20px;">
                            <input type="text" id="planSearchInput" placeholder="搜索计划名称/标签/描述..."
                                style="width: 100%; padding: 0.6rem 1rem; border: 2px solid rgba(102, 126, 234, 0.3); border-radius: 25px;
                                background: rgba(255, 255, 255, 0.6); color: #333; font-size: 0.9rem; backdrop-filter: blur(10px);
                                transition: all 0.3s ease; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                        </div>
                    </div>

                    <!-- 计划列表 -->
                    <div class="plan-list-container" style="padding: 1rem 1.5rem; flex: 1; overflow-y: auto; margin: 1rem 0; max-height: calc(100% - 130px);">
                        <div id="planList" class="plan-list" style="background: rgba(255, 255, 255, 0.4); border-radius: 8px; padding: 8px; max-height: 100%;">
                            <!-- 计划列表将在这里动态生成 -->
                        </div>
                    </div>

                    <!-- 操作按钮 -->
                    <div class="plan-actions" style="padding: 0 1.5rem 1.2rem; margin-top: 0; display: flex; gap: 10px; justify-content: center;">
                        <button id="newPlanBtn" class="btn btn-new">新建计划</button>
                        <button id="editPlanBtn" class="btn btn-open">编辑计划</button>
                        <button id="openPlanBtn" class="btn btn-open">打开计划</button>
                        <button id="deletePlanBtn" class="btn btn-danger">删除计划</button>
                    </div>
                </div>
            `;
            document.body.appendChild(manager);

            // 绑定事件
            document.getElementById('closePlanManager').addEventListener('click', () => {
                this.closePlanManager();
            });

            document.getElementById('newPlanBtn').addEventListener('click', () => {
                this.createNewPlan();
            });

            document.getElementById('editPlanBtn').addEventListener('click', () => {
                this.editSelectedPlan();
            });

            document.getElementById('openPlanBtn').addEventListener('click', () => {
                this.openSelectedPlan();
            });

            document.getElementById('deletePlanBtn').addEventListener('click', () => {
                this.deleteSelectedPlan();
            });

            // 绑定搜索事件
            const searchInput = document.getElementById('planSearchInput');
            searchInput.addEventListener('input', (e) => {
                this.filterPlans(e.target.value);
            });

            // 添加搜索框焦点效果
            searchInput.addEventListener('focus', (e) => {
                e.target.style.borderColor = 'rgba(102, 126, 234, 0.6)';
                e.target.style.boxShadow = '0 0 0 3px rgba(102, 126, 234, 0.2)';
            });

            searchInput.addEventListener('blur', (e) => {
                e.target.style.borderColor = 'rgba(102, 126, 234, 0.3)';
                e.target.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
            });
        }

        // 加载计划列表
        this.loadPlanList();

        // 显示管理界面
        manager.style.display = 'block';
    }

    // 过滤计划列表
    filterPlans(searchTerm) {
        const planItems = document.querySelectorAll('.plan-item');
        const searchLower = searchTerm.toLowerCase().trim();

        planItems.forEach(item => {
            const labelElement = item.querySelector('label');
            const planName = labelElement.querySelector('strong').textContent.toLowerCase();
            const planLabels = labelElement.querySelector('div:nth-child(2)').textContent.toLowerCase(); // 标签行
            const planTimeRange = labelElement.querySelector('div:nth-child(3)').textContent.toLowerCase(); // 时间范围行
            const planCreatedAt = labelElement.querySelector('div:nth-child(4)').textContent.toLowerCase(); // 创建时间行

            // 检查名称、标签、时间范围或创建时间中是否包含搜索词
            const matches = planName.includes(searchLower) ||
                planLabels.includes(searchLower) ||
                planTimeRange.includes(searchLower) ||
                planCreatedAt.includes(searchLower);

            if (matches) {
                item.style.display = 'block';
            } else {
                item.style.display = 'none';
            }
        });
    }

    // 关闭计划管理界面
    closePlanManager() {
        const manager = document.getElementById('planManager');
        if (manager) {
            manager.style.display = 'none';
        }
    }

    // 加载计划列表
    async loadPlanList() {
        try {
            const response = await this.makeApiRequest('/plans', 'GET');
            const planList = document.getElementById('planList');

            if (planList && response.plans) {
                planList.innerHTML = '';

                if (response.plans.length === 0) {
                    planList.innerHTML = '<p style="text-align: center; color: #999;">暂无计划</p>';
                } else {
                    // 按创建时间降序排序（最新的在前）
                    const sortedPlans = response.plans.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                    sortedPlans.forEach(plan => {
                        // 格式化日期，将 YYYYMMDD 转换为 YYYY-MM-DD 并解析
                        const formatDate = (dateStr) => {
                            if (!dateStr) return '';
                            const year = dateStr.substring(0, 4);
                            const month = dateStr.substring(4, 6);
                            const day = dateStr.substring(6, 8);
                            return `${year}-${month}-${day}`;
                        };

                        const startTime = formatDate(plan.startTime);
                        const endTime = formatDate(plan.endTime);
                        const timeRange = startTime && endTime ? `${startTime} 至 ${endTime}` : '未设置时间范围';

                        const planItem = document.createElement('div');
                        planItem.className = 'plan-item';
                        planItem.innerHTML = `
                            <label style="display: flex; align-items: center; cursor: pointer; padding: 12px; border: 1px solid #ddd; margin-bottom: 8px; border-radius: 8px; background: rgba(255, 255, 255, 0.7); transition: all 0.2s ease; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                                <input type="radio" name="selectedPlan" value="${plan.id}" style="margin-right: 12px; width: 16px; height: 16px;">
                                <div style="flex: 1;">
                                    <div><strong style="color: #333; font-size: 1.05rem;">${plan.name}</strong></div>
                                    <div style="font-size: 0.9em; color: #555; margin-top: 3px;">标签: <span style="color: #667eea; font-weight: 500;">${plan.labels && plan.labels.length > 0 ? plan.labels.join(', ') : '无标签'}</span></div>
                                    <div style="font-size: 0.85em; color: #666; margin-top: 2px;">时间: <span style="color: #667eea;">${timeRange}</span></div>
                                    <div style="font-size: 0.8em; color: #888; margin-top: 2px;">创建时间: ${new Date(plan.createdAt).toLocaleString()}</div>
                                </div>
                            </label>
                        `;
                        // 添加悬停效果
                        const label = planItem.querySelector('label');
                        label.addEventListener('mouseenter', () => {
                            label.style.transform = 'translateY(-2px)';
                            label.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                            label.style.background = 'rgba(102, 126, 234, 0.1)';
                        });
                        label.addEventListener('mouseleave', () => {
                            label.style.transform = 'translateY(0)';
                            label.style.boxShadow = '0 2px 5px rgba(0,0,0,0.05)';
                            label.style.background = 'rgba(255, 255, 255, 0.7)';
                        });

                        // 添加双击事件直接打开计划
                        label.addEventListener('dblclick', () => {
                            // 找到关联的单选按钮并选中
                            const radio = label.querySelector('input[type="radio"]');
                            if (radio) {
                                radio.checked = true;
                            }
                            // 调用打开计划的方法
                            this.openSelectedPlan();
                        });

                        planList.appendChild(planItem);
                    });

                    // 自动选择当前正在编辑的计划
                    if (this.currentPlanId) {
                        const currentPlanRadio = planList.querySelector(`input[name="selectedPlan"][value="${this.currentPlanId}"]`);
                        if (currentPlanRadio) {
                            currentPlanRadio.checked = true;
                        }
                    }
                }
            }
        } catch (error) {
            console.error('加载计划列表失败:', error);
            const planList = document.getElementById('planList');
            if (planList) {
                planList.innerHTML = '<p style="text-align: center; color: red;">加载计划列表失败: ' + error.message + '</p>';
            }
        }
    }

    // 创建新计划
    async createNewPlan() {
        // 检查是否已存在新建计划弹窗
        let newPlanModal = document.getElementById('newPlanModal');
        if (newPlanModal) {
            newPlanModal.remove();
        }

        newPlanModal = document.createElement('div');
        newPlanModal.id = 'newPlanModal';
        newPlanModal.className = 'modal';
        newPlanModal.innerHTML = `
            <div class="modal-content new-plan-modal-content" style="width: 500px; max-width: 90vw; max-height: 90vh; overflow-y: auto; margin: 5% auto;">
                <span class="close" id="closeNewPlanModal">&times;</span>
                <h3>创建新计划</h3>
                <form id="newPlanForm">
                    <div class="form-group">
                        <label for="planName">计划名称: *</label>
                        <input type="text" id="planName" class="form-control" placeholder="请输入计划名称" required>
                    </div>
                    <div class="form-group">
                        <label for="planDescription">计划描述:</label>
                        <textarea id="planDescription" class="form-control" placeholder="请输入计划描述" rows="3"></textarea>
                    </div>
                    <div class="form-group" style="display: flex; gap: 15px;">
                        <div style="flex: 1;">
                            <label for="planStartTime">开始日期: *</label>
                            <input type="date" id="planStartTime" class="form-control" required>
                        </div>
                        <div style="flex: 1;">
                            <label for="planEndTime">结束日期: *</label>
                            <input type="date" id="planEndTime" class="form-control" required>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="planLabels">标签 (用逗号分隔):</label>
                        <input type="text" id="planLabels" class="form-control" placeholder="例如: 旅行, 欧洲, 自驾">
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="useLocalData"> 使用本地缓存内容作为项目源
                        </label>
                    </div>
                    <div style="margin-top: 20px; display: flex; gap: 10px;">
                        <button type="submit" class="btn" style="flex: 1; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important; border: none !important;">创建计划</button>
                        <button type="button" id="cancelNewPlanBtn" class="btn" style="flex: 1; background-color: #ccc; color: #333;">取消</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(newPlanModal);

        // 设置默认日期为今天和7天后
        const today = new Date().toISOString().split('T')[0];
        const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        document.getElementById('planStartTime').value = today;
        document.getElementById('planEndTime').value = nextWeek;

        // 绑定事件
        document.getElementById('closeNewPlanModal').addEventListener('click', () => {
            newPlanModal.remove();
        });

        document.getElementById('cancelNewPlanBtn').addEventListener('click', () => {
            newPlanModal.remove();
        });

        // 点击弹窗外部区域也关闭弹窗
        newPlanModal.addEventListener('click', (e) => {
            if (e.target === newPlanModal) {
                newPlanModal.remove();
            }
        });

        document.getElementById('newPlanForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('planName').value.trim();
            const description = document.getElementById('planDescription').value.trim();
            const startTime = document.getElementById('planStartTime').value;
            const endTime = document.getElementById('planEndTime').value;
            const labelsInput = document.getElementById('planLabels').value.trim();
            const useLocalData = document.getElementById('useLocalData').checked;

            if (!name || !startTime || !endTime) {
                this.showSwalAlert('输入错误', '请填写所有必填字段！', 'warning');
                return;
            }

            // 将日期格式转换为API所需的格式 (YYYYMMDD)
            const formattedStartTime = startTime.replace(/-/g, '');
            const formattedEndTime = endTime.replace(/-/g, '');

            // 解析标签
            const labels = labelsInput ? labelsInput.split(',').map(label => label.trim()).filter(label => label) : [];
            if (labels.length === 0) {
                labels.push('路书'); // 默认标签
            }

            let initialContent = null;
            if (useLocalData) {
                const localDataString = localStorage.getItem('roadbookData');
                const hasLocalData = localDataString && localDataString !== '{}' && localDataString !== 'null';

                if (hasLocalData) {
                    try {
                        initialContent = JSON.parse(localDataString);
                    } catch (e) {
                        console.error('解析本地缓存数据失败:', e);
                        if (!await this.showSwalConfirm("提示", "本地缓存数据已损坏，是否创建空项目？", "是", "否").then(result => result.isConfirmed)) {
                            return;
                        }
                        localStorage.removeItem('roadbookData');
                        initialContent = null;
                    }
                } else {
                    this.showSwalAlert('提示', '没有本地缓存数据，将创建空项目。', 'info');
                }
            } else if (await this.showSwalConfirm('提示', '是否使用空白项目？(这将清空当前路书和本地缓存)', '是', '否').then(result => result.isConfirmed)) {
                this.app.clearRoadbook(); // 清空当前应用数据和本地缓存
            }

            try {
                const requestBody = {
                    name: name,
                    description: description || `路书计划 - ${new Date().toLocaleDateString()}`,
                    startTime: formattedStartTime,
                    endTime: formattedEndTime,
                    labels: labels,
                    content: initialContent // 使用本地缓存或空内容
                };

                const response = await this.makeApiRequest('/plans', 'POST', requestBody);

                if (response.id) {
                    this.showSwalAlert('创建成功', '计划创建成功！', 'success', 'top-end');
                    newPlanModal.remove(); // 关闭创建计划弹窗
                    this.loadPlanList(); // 重新加载计划列表
                    this.currentPlanId = response.id;
                    this.currentPlanName = response.name;
                    this.saveState(); // 保存状态
                    this.showEditingIndicator(response.name);

                    // 如果使用了本地缓存作为新项目源，也需要加载到app中
                    if (initialContent) {
                        this.app.loadRoadbook(initialContent, false);
                        this.app.saveToLocalStorage(); // 确保本地状态与云端同步
                    }

                    this.closePlanManager(); // 成功创建计划后关闭管理界面
                }
            } catch (error) {
                console.error('创建计划失败:', error);
                this.showSwalAlert('创建失败', '创建计划失败: ' + error.message, 'error');
            }
        });

        newPlanModal.style.display = 'block';
    }

    // 打开选中的计划
    async openSelectedPlan() {
        const selectedRadio = document.querySelector('input[name="selectedPlan"]:checked');
        if (!selectedRadio) {
            this.showSwalAlert('提示', '请先选择一个计划', 'warning');
            return;
        }

        const planId = selectedRadio.value;

        try {
            const response = await this.makeApiRequest(`/plans/${planId}`, 'GET');

            if (response.plan) {
                const cloudContent = response.plan.content;

                // 检查云端项目是否为空或其内容是否为空
                const isCloudEmpty = !cloudContent ||
                    ((!cloudContent.markers || cloudContent.markers.length === 0) &&
                        (!cloudContent.connections || cloudContent.connections.length === 0));

                if (isCloudEmpty) {
                    // 如果云端是空项目
                    const result = await this.showSwalConfirm('空项目提示', '您正在打开一个空项目。是否需要覆盖本地缓存？如果选择"是"，当前本地项目将被清空并加载空项目。', '是', '否');
                    if (result.isConfirmed) {
                        this.app.clearRoadbook(); // 清空当前应用数据和本地缓存
                        this.showSwalAlert("提示", "本地缓存已清空并加载空云端项目。", "info");
                    } else {
                        this.showSwalAlert("提示", "已取消加载空云端项目，本地缓存保持不变。请选择其他项目或新建项目。", "info");
                        this.closePlanManager(); // 用户选择不覆盖，关闭管理界面
                        return; // 终止后续操作
                    }
                }

                // 加载计划数据到app（如果cloudContent为null/undefined，则传递一个具有正确结构的空对象以加载空状态）
                this.app.loadRoadbook(cloudContent || {markers: [], connections: [], labels: [], dateNotes: {}}, false); // 不显示导入提示

                // 恢复地图源和搜索模式
                if (cloudContent) {
                    if (cloudContent.currentLayer) {
                        this.app.switchMapSource(cloudContent.currentLayer);
                        const mapSourceSelect = document.getElementById('mapSourceSelect');
                        if (mapSourceSelect) mapSourceSelect.value = cloudContent.currentLayer;
                    }
                    if (cloudContent.currentSearchMethod) {
                        this.app.currentSearchMethod = cloudContent.currentSearchMethod;
                        const searchMethodSelect = document.getElementById('searchMethodSelect');
                        if (searchMethodSelect) searchMethodSelect.value = cloudContent.currentSearchMethod;
                    }
                }

                // 保存当前计划信息
                this.currentPlanId = response.plan.id;
                this.currentPlanName = response.plan.name;
                this.saveState(); // 保存状态

                // 保存到本地缓存以覆盖现有数据
                this.app.saveToLocalStorage();

                // 显示编辑指示器
                this.showEditingIndicator(response.plan.name);

                // 关闭计划管理界面
                this.closePlanManager();

                this.showSwalAlert('成功', '计划加载成功！', 'success');
            } else {
                this.showSwalAlert('错误', '获取计划详情失败：计划数据不完整。', 'error');
                this.closePlanManager(); // 数据不完整时也关闭管理界面
            }
        } catch (error) {
            console.error('打开计划失败:', error);
            this.showSwalAlert('错误', '打开计划失败: ' + error.message, 'error');
            this.closePlanManager(); // 发生错误时关闭管理界面
        }
    }

    // 编辑选中的计划
    async editSelectedPlan() {
        const selectedRadio = document.querySelector('input[name="selectedPlan"]:checked');
        if (!selectedRadio) {
            this.showSwalAlert('提示', '请先选择一个计划', 'warning');
            return;
        }

        const planId = selectedRadio.value;

        try {
            const response = await this.makeApiRequest(`/plans/${planId}`, 'GET');

            if (response.plan) {
                this.showEditPlanModal(response.plan);
            } else {
                this.showSwalAlert('错误', '获取计划详情失败', 'error');
            }
        } catch (error) {
            console.error('获取计划详情失败:', error);
            this.showSwalAlert('错误', '获取计划详情失败: ' + error.message, 'error');
        }
    }

    // 显示编辑计划弹窗
    showEditPlanModal(plan) {
        // 检查是否已存在编辑计划弹窗
        let editPlanModal = document.getElementById('editPlanModal');
        if (editPlanModal) {
            editPlanModal.remove();
        }

        // 解析日期格式 (YYYYMMDD -> YYYY-MM-DD)
        const formatDateForInput = (dateStr) => {
            if (!dateStr) return '';
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            return `${year}-${month}-${day}`;
        };

        const startTimeFormatted = formatDateForInput(plan.startTime);
        const endTimeFormatted = formatDateForInput(plan.endTime);

        editPlanModal = document.createElement('div');
        editPlanModal.id = 'editPlanModal';
        editPlanModal.className = 'modal';
        editPlanModal.innerHTML = `
            <div class="modal-content new-plan-modal-content" style="width: 500px; max-width: 90vw; max-height: 90vh; overflow-y: auto; margin: 5% auto;">
                <span class="close" id="closeEditPlanModal">&times;</span>
                <h3>编辑计划</h3>
                <form id="editPlanForm">
                    <div class="form-group">
                        <label for="editPlanName">计划名称: *</label>
                        <input type="text" id="editPlanName" class="form-control" value="${plan.name}" required>
                    </div>
                    <div class="form-group">
                        <label for="editPlanDescription">计划描述:</label>
                        <textarea id="editPlanDescription" class="form-control" rows="3">${plan.description || ''}</textarea>
                    </div>
                    <div class="form-group" style="display: flex; gap: 15px;">
                        <div style="flex: 1;">
                            <label for="editPlanStartTime">开始日期: *</label>
                            <input type="date" id="editPlanStartTime" class="form-control" value="${startTimeFormatted}" required>
                        </div>
                        <div style="flex: 1;">
                            <label for="editPlanEndTime">结束日期: *</label>
                            <input type="date" id="editPlanEndTime" class="form-control" value="${endTimeFormatted}" required>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="editPlanLabels">标签 (用逗号分隔):</label>
                        <input type="text" id="editPlanLabels" class="form-control" value="${plan.labels ? plan.labels.join(', ') : ''}">
                    </div>
                    <div style="margin-top: 20px; display: flex; gap: 10px;">
                        <button type="submit" class="btn" style="flex: 1; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important; border: none !important;">保存计划</button>
                        <button type="button" id="cancelEditPlanBtn" class="btn" style="flex: 1; background-color: #ccc; color: #333;">取消</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(editPlanModal);

        // 绑定事件
        document.getElementById('closeEditPlanModal').addEventListener('click', () => {
            editPlanModal.remove();
        });

        document.getElementById('cancelEditPlanBtn').addEventListener('click', () => {
            editPlanModal.remove();
        });

        // 点击弹窗外部区域也关闭弹窗
        editPlanModal.addEventListener('click', (e) => {
            if (e.target === editPlanModal) {
                editPlanModal.remove();
            }
        });

        document.getElementById('editPlanForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('editPlanName').value.trim();
            const description = document.getElementById('editPlanDescription').value.trim();
            const startTime = document.getElementById('editPlanStartTime').value;
            const endTime = document.getElementById('editPlanEndTime').value;
            const labelsInput = document.getElementById('editPlanLabels').value.trim();

            if (!name || !startTime || !endTime) {
                this.showSwalAlert('输入错误', '请填写所有必填字段！', 'warning');
                return;
            }

            // 将日期格式转换为API所需的格式 (YYYYMMDD)
            const formattedStartTime = startTime.replace(/-/g, '');
            const formattedEndTime = endTime.replace(/-/g, '');

            // 解析标签
            const labels = labelsInput ? labelsInput.split(',').map(label => label.trim()).filter(label => label) : [];

            try {
                // 获取当前应用内容（如果当前正在编辑此计划）
                let currentContent = null;
                if (this.currentPlanId === plan.id) {
                    currentContent = {
                        version: '2.0',
                        exportTime: new Date().toISOString(),
                        currentLayer: this.app.currentLayer,
                        currentSearchMethod: this.app.currentSearchMethod,
                        markers: this.app.markers.map((m) => ({
                            id: m.id,
                            position: m.position,
                            title: m.title,
                            labels: m.labels || [],
                            createdAt: m.createdAt,
                            dateTimes: m.dateTimes || [m.dateTime],
                            icon: m.icon
                        })),
                        connections: this.app.connections.map(c => {
                            const startMarker = this.app.markers.find(m => m.id === c.startId);
                            const endMarker = this.app.markers.find(m => m.id === c.endId);

                            return {
                                id: c.id,
                                startId: c.startId,
                                endId: c.endId,
                                transportType: c.transportType,
                                dateTime: c.dateTime,
                                label: c.label || '',
                                duration: c.duration || 0,
                                startTitle: startMarker ? startMarker.title : c.startTitle,
                                endTitle: endMarker ? endMarker.title : c.endTitle
                            };
                        }),
                        labels: this.app.labels.map(l => ({
                            markerIndex: this.app.markers.indexOf(l.marker),
                            content: l.content
                        })),
                        dateNotes: this.app.dateNotes || {}
                    };
                } else {
                    // 如果不是当前计划，获取云端的原始内容
                    const response = await this.makeApiRequest(`/plans/${plan.id}`, 'GET');
                    currentContent = response.plan.content;
                }

                const requestBody = {
                    name: name,
                    description: description,
                    startTime: formattedStartTime,
                    endTime: formattedEndTime,
                    labels: labels,
                    content: currentContent
                };

                const response = await this.makeApiRequest(`/plans/${plan.id}`, 'PUT', requestBody);

                if (response.id) {
                    this.showSwalAlert('成功', '计划更新成功！', 'success');
                    editPlanModal.remove(); // 关闭编辑计划弹窗
                    this.loadPlanList(); // 重新加载计划列表

                    // 如果编辑的是当前正在编辑的计划，更新当前计划信息
                    if (this.currentPlanId === plan.id) {
                        this.currentPlanName = response.name;
                        this.saveState(); // 保存状态
                        this.showEditingIndicator(response.name);
                    }
                }
            } catch (error) {
                this.showSwalAlert('错误', '更新计划失败: ' + error.message, 'error');
            }
        });

        editPlanModal.style.display = 'block';
    }

    // 删除选中的计划
    async deleteSelectedPlan() {
        const selectedRadio = document.querySelector('input[name="selectedPlan"]:checked');
        if (!selectedRadio) {
            this.showSwalAlert('提示', '请先选择一个计划', 'warning');
            return;
        }

        const planId = selectedRadio.value;
        const planName = selectedRadio.parentElement.querySelector('strong').textContent;
        if (!await this.showSwalConfirm('删除确认', `确定要删除计划 "${planName}" 吗？此操作不可恢复。`, '删除', '取消').then(result => result.isConfirmed)) {
            return;
        }

        try {
            const response = await this.makeApiRequest(`/plans/${planId}`, 'DELETE');

            if (response.message) {
                this.showSwalAlert('成功', '计划删除成功！', 'success');
                this.loadPlanList(); // 重新加载计划列表

                // 如果删除的是当前正在编辑的计划，清空当前计划信息
                if (this.currentPlanId === planId) {
                    this.currentPlanId = null;
                    this.currentPlanName = null;
                    this.saveState(); // 保存状态
                    this.hideEditingIndicator();
                }
            }
        } catch (error) {
            this.showSwalAlert('错误', '删除计划失败: ' + error.message, 'error');
        }
    }

    // 保存到云端
    async saveToCloud() {
        if (!this.currentPlanId) {
            this.showSwalAlert('提示', '当前没有打开的计划，请先打开或创建一个计划', 'warning');
            return;
        }

        try {
            // 获取当前app数据
            const currentData = {
                version: '2.0',
                exportTime: new Date().toISOString(),
                currentLayer: this.app.currentLayer,
                currentSearchMethod: this.app.currentSearchMethod,
                markers: this.app.markers.map((m) => ({
                    id: m.id,
                    position: m.position,
                    title: m.title,
                    labels: m.labels || [],
                    createdAt: m.createdAt,
                    dateTimes: m.dateTimes || [m.dateTime],
                    icon: m.icon
                })),
                connections: this.app.connections.map(c => {
                    const startMarker = this.app.markers.find(m => m.id === c.startId);
                    const endMarker = this.app.markers.find(m => m.id === c.endId);

                    return {
                        id: c.id,
                        startId: c.startId,
                        endId: c.endId,
                        transportType: c.transportType,
                        dateTime: c.dateTime,
                        label: c.label || '',
                        duration: c.duration || 0,
                        startTitle: startMarker ? startMarker.title : c.startTitle,
                        endTitle: endMarker ? endMarker.title : c.endTitle
                    };
                }),
                labels: this.app.labels.map(l => ({
                    markerIndex: this.app.markers.indexOf(l.marker),
                    content: l.content
                })),
                dateNotes: this.app.dateNotes || {}
            };

            const response = await this.makeApiRequest(`/plans/${this.currentPlanId}`, 'PUT', {
                name: this.currentPlanName,
                description: `路书计划 - ${new Date().toLocaleDateString()}`,
                startTime: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
                endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, ''),
                labels: ['路书', '旅行'],
                content: currentData
            });

            if (response.id) {
                // 保存成功后也更新本地缓存
                this.app.saveToLocalStorage();
                // 更新保存的哈希值
                this.lastSavedHash = this.getContentHash();
                // 立即更新UI状态
                this.updateEditingIndicator(false);
                // 显示右上角成功提示
                this.showSaveSuccessToast();
            }
        } catch (error) {
            this.showSwalAlert('保存失败', '保存失败: ' + error.message, 'error');
        }
    }

    // 显示编辑指示器
    showEditingIndicator(planName) {
        const onlineModeActions = document.getElementById('onlineModeActions');
        if (!onlineModeActions) return;

        let indicator = document.getElementById('editingIndicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'editingIndicator';
            indicator.className = 'editing-indicator'; // 添加类名以便CSS控制
            // 移除行内样式，通过CSS文件控制
            onlineModeActions.insertBefore(indicator, onlineModeActions.firstChild); // 插入到最前面
        }

        indicator.textContent = `正在编辑: ${planName}`;
        indicator.style.display = 'block';
        onlineModeActions.style.display = 'flex'; // 确保容器可见

        // 启动内容变化检测
        this.startContentMonitoring();
    }

    // 隐藏编辑指示器
    hideEditingIndicator() {
        const indicator = document.getElementById('editingIndicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
        const onlineModeActions = document.getElementById('onlineModeActions');
        if (onlineModeActions && onlineModeActions.children.length === 0) {
            onlineModeActions.style.display = 'none';
        }

        // 停止内容变化检测
        this.stopContentMonitoring();
    }

    // 计算内容哈希值（完整JSON序列化版本）
    getContentHash() {
        try {
            // 完整序列化所有相关内容，包括属性变化
            const data = {
                markers: this.app.markers.map(m => {
                    // 确保包含所有可能影响保存的属性
                    const markerData = {
                        id: m.id,
                        position: m.position,
                        title: m.title,
                        labels: m.labels || [],
                        icon: m.icon,
                        createdAt: m.createdAt,
                        dateTimes: m.dateTimes || [],
                        dateTime: m.dateTime
                    };
                    return JSON.stringify(markerData, Object.keys(markerData).sort());
                }).sort(), // 排序确保顺序一致
                connections: this.app.connections.map(c => {
                    const connData = {
                        id: c.id,
                        startId: c.startId,
                        endId: c.endId,
                        transportType: c.transportType,
                        dateTime: c.dateTime,
                        label: c.label || '',
                        duration: c.duration || 0,
                        startTitle: c.startTitle,
                        endTitle: c.endTitle
                    };
                    return JSON.stringify(connData, Object.keys(connData).sort());
                }).sort(), // 排序确保顺序一致
                labels: this.app.labels.map(l => ({
                    markerIndex: this.app.markers.indexOf(l.marker),
                    content: l.content
                })),
                dateNotes: this.app.dateNotes || {},
                currentLayer: this.app.currentLayer,
                currentSearchMethod: this.app.currentSearchMethod
            };

            // 使用稳定的JSON序列化，确保属性顺序一致
            return JSON.stringify(data, Object.keys(data).sort());
        } catch (error) {
            console.error('计算内容哈希失败:', error);
            return null;
        }
    }

    // 启动内容变化检测（简化版本）
    startContentMonitoring() {
        if (this.contentCheckInterval) {
            clearInterval(this.contentCheckInterval);
        }

        // 初始化最后保存的哈希值
        this.lastSavedHash = this.getContentHash();

        // 每5秒检查一次内容变化
        this.contentCheckInterval = setInterval(() => {
            if (this.mode === 'online' && this.currentPlanId) {
                this.checkContentChanges();
            }
        }, 5000);
    }

    // 停止内容变化检测
    stopContentMonitoring() {
        if (this.contentCheckInterval) {
            clearInterval(this.contentCheckInterval);
            this.contentCheckInterval = null;
        }
    }

    // 检查内容变化并更新UI
    checkContentChanges() {
        const currentHash = this.getContentHash();
        if (!currentHash || !this.lastSavedHash) {
            return;
        }

        const hasChanges = currentHash !== this.lastSavedHash;
        this.updateEditingIndicator(hasChanges);
    }

    // 更新编辑指示器
    updateEditingIndicator(hasChanges) {
        const indicator = document.getElementById('editingIndicator');
        if (!indicator) return;

        const planName = this.currentPlanName || '未命名计划';
        const unsavedText = hasChanges ? ' (未保存)' : '';
        indicator.textContent = `正在编辑: ${planName}${unsavedText}`;

        // 根据是否有未保存的更改来设置CSS类
        if (hasChanges) {
            indicator.classList.add('unsaved'); // 添加未保存状态的CSS类
        } else {
            indicator.classList.remove('unsaved'); // 移除未保存状态的CSS类
        }
    }

    // 显示保存成功提示
    showSaveSuccessToast() {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                position: 'top-end',
                icon: 'success',
                title: '保存成功',
                text: '计划已保存到云端',
                showConfirmButton: false,
                timer: 2000,
                toast: true,
                background: '#4caf50',
                color: '#fff',
                iconColor: '#fff',
                customClass: {
                    popup: 'save-success-toast'
                }
            });
        } else {
            console.log('保存成功：计划已保存到云端');
        }
    }

    // SweetAlert2 工具函数
    showSwalAlert(title, text, icon = 'info', position = 'center') {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: title,
                text: text,
                icon: icon,
                position: position,
                showConfirmButton: true,
                confirmButtonText: '确定',
                confirmButtonColor: '#667eea',
                timer: icon === 'success' ? 2000 : undefined,
                toast: position === 'top-end',
                background: icon === 'success' ? '#4caf50' : '#fff',
                color: icon === 'success' ? '#fff' : '#333',
                iconColor: icon === 'success' ? '#fff' : undefined
            });
        } else {
            // 如果SweetAlert2不可用，回退到普通alert
            alert(text);
        }
    }

    // SweetAlert2 确认对话框
    showSwalConfirm(title, text, confirmText = '确定', cancelText = '取消') {
        if (typeof Swal !== 'undefined') {
            return Swal.fire({
                title: title,
                text: text,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: confirmText,
                cancelButtonText: cancelText,
                confirmButtonColor: '#667eea',
                cancelButtonColor: '#6c757d'
            });
        } else {
            // 如果SweetAlert2不可用，回退到普通confirm
            return Promise.resolve({isConfirmed: confirm(text)});
        }
    }

    // 获取API基础URL（根据环境判断）
    getApiBaseUrl() {
        // 检查是否是本地开发环境（域名是localhost、127.0.0.1或类似本地地址）
        const hostname = window.location.hostname || '';
        const protocol = window.location.protocol || '';
        console.log('当前页面主机名:', hostname, '协议:', protocol);

        // 检查是否为本地开发环境
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
            return 'http://127.0.0.1:5436/api/v1';
        } else if (protocol === 'file:') {
            // 如果是file协议，强制使用本地后端（开发场景）
            return 'http://127.0.0.1:5436/api/v1';
        } else {
            // 生产环境使用当前域名
            const url = window.location.origin + '/api/v1';
            console.log('生产环境API URL:', url);
            return url;
        }
    }

    // 执行API请求的通用方法
    async makeApiRequest(endpoint, method = 'GET', data = null) {
        const baseUrl = this.getApiBaseUrl();
        const url = baseUrl + endpoint;

        // 确保URL是完整的
        console.log('API请求URL:', url, '基础URL:', baseUrl, '端点:', endpoint);

        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        if (this.token) {
            options.headers['Authorization'] = `Bearer ${this.token}`;
        }

        if (data && method !== 'GET') {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(url, options);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `请求失败: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }
}

// 在DOM加载完成后初始化在线模式管理器
document.addEventListener('DOMContentLoaded', () => {
    // 确保app已初始化
    const initializeOnlineMode = () => {
        if (window.app) {
            window.onlineModeManager = new OnlineModeManager(window.app);
        } else {
            // 如果app还没初始化，稍后重试
            setTimeout(initializeOnlineMode, 100);
        }
    };

    initializeOnlineMode();
});
