// 在线模式功能实现
class OnlineModeManager {
    constructor(app) {
        this.app = app;
        this.mode = 'offline'; // 默认离线模式
        this.token = localStorage.getItem('online_token') || null;
        this.currentPlanId = null;
        this.currentPlanName = null;
        this.initialize();
    }

    initialize() {
        // 创建在线模式选择下拉框
        this.createModeSelector();

        // 检查当前是否有有效token，如果有则更新UI状态
        if (this.token) {
            this.checkTokenValidity();
        }
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

        // 如果退出在线模式，清空当前计划信息
        if (mode !== 'online') {
            this.currentPlanId = null;
            this.currentPlanName = null;
            this.hideEditingIndicator();
        }
    }

    // 切换保存按钮显示
    toggleSaveButton(show) {
        const onlineModeActions = document.getElementById('onlineModeActions');
        if (!onlineModeActions) return;

        let saveButton = document.getElementById('cloudSaveBtn');
        let settingsButton = document.getElementById('cloudSettingsBtn');

        if (show) {
            if (!saveButton) {
                saveButton = document.createElement('button');
                saveButton.id = 'cloudSaveBtn';
                saveButton.className = 'btn';
                saveButton.innerHTML = '<span class="icon">💾</span><span>保存到云端</span>'; // 添加图标和文本
                saveButton.addEventListener('click', () => {
                    this.saveToCloud();
                });
                onlineModeActions.appendChild(saveButton);
            }

            if (!settingsButton) {
                settingsButton = document.createElement('button');
                settingsButton.id = 'cloudSettingsBtn';
                settingsButton.className = 'btn';
                settingsButton.innerHTML = '<span class="icon">⚙️</span><span>设置</span>'; // 设置图标和文本
                settingsButton.addEventListener('click', () => {
                    this.showPlanManager(); // 点击打开计划管理界面
                });
                onlineModeActions.appendChild(settingsButton);
            }
            onlineModeActions.style.display = 'flex'; // 显示容器
        } else {
            if (saveButton) {
                saveButton.remove();
            }
            if (settingsButton) {
                settingsButton.remove();
            }
            // 如果onlineModeActions中没有其他子元素，则隐藏它
            if (onlineModeActions.children.length === 0) {
                onlineModeActions.style.display = 'none';
            }
        }
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
    }

    // 处理登录请求
    async handleLogin() {
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value.trim();

        if (!username || !password) {
            alert('请输入账号和密码');
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
                alert('登录失败: ' + (response.message || '未知错误'));
                // 登录失败时切换回离线模式
                this.mode = 'offline';
                this.updateUIForMode('offline');
            }
        } catch (error) {
            console.error('登录错误:', error);
            alert('登录失败: ' + error.message);
            // 登录失败时切换回离线模式
            this.mode = 'offline';
            this.updateUIForMode('offline');
        }
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
                <div class="modal-content" style="width: 800px; max-width: 90vw;">
                    <span class="close" id="closePlanManager">&times;</span>
                    <h3>计划管理</h3>

                    <!-- 计划列表 -->
                    <div class="plan-list-container">
                        <div id="planList" class="plan-list">
                            <!-- 计划列表将在这里动态生成 -->
                        </div>
                    </div>

                    <!-- 操作按钮 -->
                    <div class="plan-actions" style="margin-top: 20px; display: flex;">
                        <button id="newPlanBtn" class="btn btn-new">新建计划</button>
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

            document.getElementById('openPlanBtn').addEventListener('click', () => {
                this.openSelectedPlan();
            });

            document.getElementById('deletePlanBtn').addEventListener('click', () => {
                this.deleteSelectedPlan();
            });
        }

        // 加载计划列表
        this.loadPlanList();

        // 显示管理界面
        manager.style.display = 'block';
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
                    response.plans.forEach(plan => {
                        const planItem = document.createElement('div');
                        planItem.className = 'plan-item';
                        planItem.innerHTML = `
                            <label style="display: flex; align-items: center; cursor: pointer; padding: 10px; border: 1px solid #ddd; margin-bottom: 5px; border-radius: 4px;">
                                <input type="radio" name="selectedPlan" value="${plan.id}" style="margin-right: 10px;">
                                <div>
                                    <div><strong>${plan.name}</strong></div>
                                    <div style="font-size: 0.9em; color: #666;">${plan.description || '无描述'}</div>
                                    <div style="font-size: 0.8em; color: #999;">${new Date(plan.createdAt).toLocaleString()}</div>
                                </div>
                            </label>
                        `;
                        planList.appendChild(planItem);
                    });
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
        const planName = prompt('请输入新计划名称:');
        if (!planName) return;

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
                    labels: m.labels,
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
                        label: c.label,
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

            const response = await this.makeApiRequest('/plans', 'POST', {
                name: planName,
                description: `路书计划 - ${new Date().toLocaleDateString()}`,
                startTime: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
                endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, ''), // 7天后
                labels: ['路书', '旅行'],
                content: currentData
            });

            if (response.id) {
                alert('计划创建成功！');
                this.loadPlanList(); // 重新加载计划列表
                this.currentPlanId = response.id;
                this.currentPlanName = response.name;
                this.showEditingIndicator(response.name);
            }
        } catch (error) {
            console.error('创建计划失败:', error);
            alert('创建计划失败: ' + error.message);
        }
    }

    // 打开选中的计划
    async openSelectedPlan() {
        const selectedRadio = document.querySelector('input[name="selectedPlan"]:checked');
        if (!selectedRadio) {
            alert('请先选择一个计划');
            return;
        }

        const planId = selectedRadio.value;

        try {
            const response = await this.makeApiRequest(`/plans/${planId}`, 'GET');

            if (response.plan && response.plan.content) {
                // 加载计划数据到app
                this.app.loadRoadbook(response.plan.content, false); // 不显示导入提示

                // 保存当前计划信息
                this.currentPlanId = response.plan.id;
                this.currentPlanName = response.plan.name;

                // 保存到本地缓存以覆盖现有数据
                this.app.saveToLocalStorage();

                // 显示编辑指示器
                this.showEditingIndicator(response.plan.name);

                // 关闭计划管理界面
                this.closePlanManager();

                alert('计划加载成功！');
            }
        } catch (error) {
            console.error('打开计划失败:', error);
            alert('打开计划失败: ' + error.message);
        }
    }

    // 删除选中的计划
    async deleteSelectedPlan() {
        const selectedRadio = document.querySelector('input[name="selectedPlan"]:checked');
        if (!selectedRadio) {
            alert('请先选择一个计划');
            return;
        }

        const planId = selectedRadio.value;
        const planName = selectedRadio.parentElement.querySelector('strong').textContent;

        if (!confirm(`确定要删除计划 "${planName}" 吗？此操作不可恢复。`)) {
            return;
        }

        try {
            const response = await this.makeApiRequest(`/plans/${planId}`, 'DELETE');

            if (response.message) {
                alert('计划删除成功！');
                this.loadPlanList(); // 重新加载计划列表

                // 如果删除的是当前正在编辑的计划，清空当前计划信息
                if (this.currentPlanId === planId) {
                    this.currentPlanId = null;
                    this.currentPlanName = null;
                    this.hideEditingIndicator();
                }
            }
        } catch (error) {
            console.error('删除计划失败:', error);
            alert('删除计划失败: ' + error.message);
        }
    }

    // 保存到云端
    async saveToCloud() {
        if (!this.currentPlanId) {
            alert('当前没有打开的计划，请先打开或创建一个计划');
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
                alert('计划保存成功！');
            }
        } catch (error) {
            console.error('保存到云端失败:', error);
            alert('保存失败: ' + error.message);
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
            const url = `${protocol}//${hostname}/api/v1`;
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
