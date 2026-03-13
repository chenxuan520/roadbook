/**
 * Debug Mode Module
 * 调试模式功能模块
 */

(function() {
    'use strict';

    // 调试模块类
    class DebugModule {
        constructor(app) {
            this.app = app;
        }

        /**
         * 初始化调试功能
         */
        initDebugFeatures() {
            const debugBtn = document.getElementById('debugBtn');
            if (debugBtn) {
                debugBtn.style.display = 'flex';
                debugBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showDebugInfo();
                });
            }
        }

        /**
         * 显示调试信息窗口
         */
        showDebugInfo() {
            // 移除已存在的调试窗口
            const existingModal = document.getElementById('debugInfoModal');
            if (existingModal) {
                document.body.removeChild(existingModal);
                return;
            }

            // 创建遮罩和模态窗口
            const modal = document.createElement('div');
            modal.id = 'debugInfoModal';

            const modalContent = document.createElement('div');
            modalContent.className = 'debug-modal-content';

            const closeButton = document.createElement('button');
            closeButton.innerText = '✖';
            closeButton.className = 'debug-modal-close';
            closeButton.onclick = () => {
                document.body.removeChild(modal);
            };

            // 标题
            const title = document.createElement('h3');
            title.textContent = '🔧 调试信息';
            title.style.cssText = 'margin: 0 0 20px 0; color: var(--text-primary, #333); font-size: 18px;';
            modalContent.appendChild(title);

            // 收集数据
            const debugData = {
                localStorage: {},
                appState: {
                    markers: this.app.markers.map(m => ({
                        id: m.id,
                        position: m.position,
                        title: m.title,
                        labels: m.labels,
                        logo: m.logo,
                        icon: m.icon,
                        createdAt: m.createdAt,
                        dateTimes: m.dateTimes
                    })),
                    connections: this.app.connections.map(c => ({
                        id: c.id,
                        startId: c.startId,
                        endId: c.endId,
                        transportType: c.transportType,
                        dateTime: c.dateTime,
                        label: c.label,
                        logo: c.logo,
                        duration: c.duration
                    })),
                    dateNotes: this.app.dateNotes,
                    history: this.app.history,
                    map: {
                        center: this.app.map.getCenter(),
                        zoom: this.app.map.getZoom()
                    }
                }
            };

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                try {
                    debugData.localStorage[key] = JSON.parse(localStorage.getItem(key));
                } catch (e) {
                    debugData.localStorage[key] = localStorage.getItem(key);
                }
            }

            // 创建分组容器
            const groupsContainer = document.createElement('div');
            groupsContainer.id = 'debugGroupsContainer';

            // 创建 LocalStorage 分组
            const localStorageGroup = this.createDebugGroup(
                '💾 LocalStorage',
                debugData.localStorage,
                'localStorage'
            );
            groupsContainer.appendChild(localStorageGroup);

            // 创建 AppState 分组
            const appStateGroup = this.createDebugGroup(
                '📊 应用状态',
                debugData.appState,
                'appState'
            );
            groupsContainer.appendChild(appStateGroup);

            modalContent.appendChild(closeButton);
            modalContent.appendChild(groupsContainer);
            modal.appendChild(modalContent);
            document.body.appendChild(modal);

            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    document.body.removeChild(modal);
                }
            });
        }

        /**
         * 创建可折叠的调试分组
         * @param {string} title - 分组标题
         * @param {object} data - 分组数据
         * @param {string} groupName - 分组名称（用于标识）
         * @returns {HTMLElement} - 分组元素
         */
        createDebugGroup(title, data, groupName) {
            const group = document.createElement('div');
            group.className = 'debug-group';
            group.dataset.group = groupName;

            const header = document.createElement('div');
            header.className = 'debug-group-header';

            const titleDiv = document.createElement('div');
            titleDiv.className = 'debug-group-title';

            // 图标（根据分组名称使用不同 emoji）
            const icon = document.createElement('span');
            icon.className = 'debug-group-icon';
            if (groupName === 'localStorage') {
                icon.textContent = '💾';
            } else if (groupName === 'appState') {
                icon.textContent = '📊';
            } else {
                icon.textContent = '📋';
            }

            const titleText = document.createElement('span');
            titleText.textContent = title.slice(2);

            const count = document.createElement('span');
            count.className = 'debug-count';
            count.textContent = `(${Object.keys(data).length} 项)`;
            count.style.cssText = 'font-size: 12px; color: var(--text-secondary, #666); margin-left: 8px;';

            titleDiv.appendChild(icon);
            titleDiv.appendChild(titleText);
            titleDiv.appendChild(count);

            const toggle = document.createElement('span');
            toggle.className = 'debug-group-toggle';
            toggle.textContent = '📁'; // 默认关闭

            // 把 titleDiv 和 toggle 添加到 header
            header.appendChild(titleDiv);
            header.appendChild(toggle);

            const content = document.createElement('div');
            content.className = 'debug-group-content'; // 默认折叠，不加 expanded

            if (Object.keys(data).length === 0) {
                const emptyHint = document.createElement('div');
                emptyHint.className = 'debug-empty-hint';
                emptyHint.textContent = '暂无数据';
                content.appendChild(emptyHint);
            } else {
                for (const [key, value] of Object.entries(data)) {
                    const subGroup = this.createDebugSubGroup(key, value);
                    content.appendChild(subGroup);
                }
            }

            // 点击头部切换展开/折叠
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const isExpanded = content.classList.contains('expanded');
                content.classList.toggle('expanded');
                toggle.textContent = isExpanded ? '📂' : '📁';
            });

            group.appendChild(header);
            group.appendChild(content);

            return group;
        }

        /**
         * 创建子分组（用于展示单个 key-value）
         * @param {string} key - 数据键
         * @param {any} value - 数据值
         * @returns {HTMLElement} - 子分组元素
         */
        createDebugSubGroup(key, value) {
            const subGroup = document.createElement('div');
            subGroup.className = 'debug-sub-group';

            const header = document.createElement('div');
            header.className = 'debug-sub-group-header';

            const titleSpan = document.createElement('span');
            titleSpan.className = 'debug-sub-group-title';
            titleSpan.textContent = key;

            const toggle = document.createElement('span');
            toggle.className = 'debug-sub-group-toggle';
            toggle.textContent = '📁'; // 默认关闭

            // 复制按钮
            const copyBtn = document.createElement('span');
            copyBtn.className = 'debug-copy-btn';
            copyBtn.textContent = '📋';
            copyBtn.title = '点击复制';

            // 把 title、toggle 和 copyBtn 添加到 header
            header.appendChild(titleSpan);
            header.appendChild(toggle);
            header.appendChild(copyBtn);

            const content = document.createElement('div');
            content.className = 'debug-sub-group-content'; // 默认折叠，不加 expanded

            let formattedValue;
            if (typeof value === 'object' && value !== null) {
                formattedValue = JSON.stringify(value, null, 2);
            } else {
                formattedValue = String(value);
            }
            content.textContent = formattedValue;

            // 点击 header 切换展开/折叠
            header.addEventListener('click', (e) => {
                if (e.target === copyBtn) return; // 点击复制按钮不触发展开/折叠
                e.stopPropagation();
                const isExpanded = content.classList.contains('expanded');
                content.classList.toggle('expanded');
                toggle.textContent = isExpanded ? '📂' : '📁';
            });

            // 复制按钮点击事件
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(formattedValue).then(() => {
                    // 复制成功后显示提示
                    copyBtn.textContent = '✅';
                    setTimeout(() => {
                        copyBtn.textContent = '📋';
                    }, 1500);
                }).catch(() => {
                    // 复制失败
                    copyBtn.textContent = '❌';
                    setTimeout(() => {
                        copyBtn.textContent = '📋';
                    }, 1500);
                });
            });

            subGroup.appendChild(header);
            subGroup.appendChild(content);

            return subGroup;
        }
    }

    // 导出到全局
    window.DebugModule = DebugModule;
})();
