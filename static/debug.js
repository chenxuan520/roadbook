/**
 * Debug Mode Module
 * 调试模式功能模块
 */

(function() {
    'use strict';

    function safeStringify(value) {
        try {
            return JSON.stringify(value, null, 2);
        } catch (e) {
            try {
                // 最简兜底：避免循环引用导致调试窗口直接崩
                return String(value);
            } catch {
                return '[Unstringifiable]';
            }
        }
    }

    function formatValue(value) {
        if (typeof value === 'object' && value !== null) return safeStringify(value);
        return String(value);
    }

    function nowISO() {
        try {
            return new Date().toISOString();
        } catch {
            return '';
        }
    }

    function getTimeZone() {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        } catch {
            return '';
        }
    }

    function guessPlatformFromUserAgent(ua) {
        const s = String(ua || '').toLowerCase();
        if (!s) return '';
        if (s.includes('windows')) return 'Windows';
        if (s.includes('mac os') || s.includes('macintosh')) return 'macOS';
        if (s.includes('iphone') || s.includes('ipad') || s.includes('ipod')) return 'iOS';
        if (s.includes('android')) return 'Android';
        if (s.includes('linux')) return 'Linux';
        return '';
    }

    function getPlatformLabel() {
        try {
            // UA Client Hints (preferred; avoids deprecated navigator.platform)
            const uaData = navigator.userAgentData;
            const p = uaData && uaData.platform;
            if (p) return String(p);
        } catch {
            // ignore
        }
        return guessPlatformFromUserAgent(navigator.userAgent);
    }

    function calcLocalStorageStats() {
        let totalChars = 0;
        const perKey = {};

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const raw = localStorage.getItem(key);
                const size = (key ? key.length : 0) + (raw ? raw.length : 0);
                perKey[key] = {
                    chars: size,
                    approxKB: Math.round((size / 1024) * 100) / 100
                };
                totalChars += size;
            }
        } catch {
            // ignore
        }

        return {
            total: {
                chars: totalChars,
                approxKB: Math.round((totalChars / 1024) * 100) / 100
            },
            perKey
        };
    }

    // 调试模块类
    class DebugModule {
        constructor(app) {
            this.app = app;
        }

        /**
         * 初始化调试功能
         */
        initDebugFeatures() {
            this.installDebugHooks();
            const debugBtn = document.getElementById('debugBtn');
            if (debugBtn) {
                debugBtn.style.display = 'flex';
                debugBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showDebugInfo();
                });
            }
        }

        installDebugHooks() {
            if (window.__debugHooksInstalled) return;
            window.__debugHooksInstalled = true;

            window.__debugLogs = window.__debugLogs || [];
            window.__debugErrors = window.__debugErrors || [];

            const MAX_LOGS = 200;
            const MAX_ERRORS = 50;

            function pushLog(level, args) {
                try {
                    const preview = Array.from(args || []).map((a) => {
                        try {
                            if (typeof a === 'string') return a;
                            if (a instanceof Error) return `${a.name}: ${a.message}`;
                            return safeStringify(a);
                        } catch {
                            return String(a);
                        }
                    });
                    window.__debugLogs.push({ ts: nowISO(), level, preview });
                    if (window.__debugLogs.length > MAX_LOGS) {
                        window.__debugLogs.splice(0, window.__debugLogs.length - MAX_LOGS);
                    }
                } catch {
                    // ignore
                }
            }

            function pushError(type, detail) {
                try {
                    window.__debugErrors.push({ ts: nowISO(), type, detail });
                    if (window.__debugErrors.length > MAX_ERRORS) {
                        window.__debugErrors.splice(0, window.__debugErrors.length - MAX_ERRORS);
                    }
                } catch {
                    // ignore
                }
            }

            // hook console
            const consoleLevels = ['log', 'info', 'warn', 'error', 'debug'];
            consoleLevels.forEach((level) => {
                const orig = console[level];
                if (typeof orig !== 'function') return;
                console[level] = function(...args) {
                    pushLog(level, args);
                    return orig.apply(this, args);
                };
            });

            // 捕获未处理异常
            window.addEventListener('error', (e) => {
                const detail = {
                    message: e && e.message,
                    filename: e && e.filename,
                    lineno: e && e.lineno,
                    colno: e && e.colno,
                    stack: e && e.error && e.error.stack
                };
                pushError('error', detail);
            });

            window.addEventListener('unhandledrejection', (e) => {
                let reasonPreview = '';
                try {
                    const r = e && e.reason;
                    if (typeof r === 'string') reasonPreview = r;
                    else if (r instanceof Error) reasonPreview = `${r.name}: ${r.message}`;
                    else reasonPreview = safeStringify(r);
                } catch {
                    reasonPreview = '[Unknown reason]';
                }
                pushError('unhandledrejection', { reason: reasonPreview });
            });
        }

        copyText(text, onDone) {
            const done = (ok) => {
                if (typeof onDone === 'function') onDone(ok);
            };

            const content = String(text || '');

            // Modern clipboard API (requires secure context in most browsers)
            try {
                if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(content).then(() => done(true)).catch(() => {
                        this.promptManualCopy(content);
                        done(false);
                    });
                    return;
                }
            } catch {
                // ignore
            }

            // Non-secure context fallback (file:// or http://): no reliable modern auto-copy.
            // Use a system prompt to let the user manually copy.
            this.promptManualCopy(content);
            done(false);
        }

        promptManualCopy(text) {
            try {
                const platform = getPlatformLabel();
                const isMac = /mac|ios/i.test(String(platform || ''));
                const shortcut = isMac ? '⌘+C' : 'Ctrl+C';
                // Using prompt keeps UI minimal and does not change existing icons/buttons.
                window.prompt(i18next.t('debug.manual_copy', {shortcut}), String(text || ''));
            } catch {
                // ignore
            }
        }

        downloadText(filename, text) {
            try {
                const blob = new Blob([text], { type: 'application/json; charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch {
                // ignore
            }
        }

        buildDebugSnapshot() {
            const urlParams = new URLSearchParams(window.location.search);
            const shareID = urlParams.get('shareID');

            const envInfo = {
                now: nowISO(),
                timeZone: getTimeZone(),
                href: String(window.location.href || ''),
                pathname: String(window.location.pathname || ''),
                search: String(window.location.search || ''),
                referrer: String(document.referrer || ''),
                userAgent: String(navigator.userAgent || ''),
                language: String(navigator.language || ''),
                languages: Array.isArray(navigator.languages) ? navigator.languages : [],
                platform: getPlatformLabel(),
                onLine: typeof navigator.onLine === 'boolean' ? navigator.onLine : null,
                cookieEnabled: typeof navigator.cookieEnabled === 'boolean' ? navigator.cookieEnabled : null,
                screen: {
                    width: window.screen && window.screen.width,
                    height: window.screen && window.screen.height
                },
                viewport: {
                    innerWidth: window.innerWidth,
                    innerHeight: window.innerHeight,
                    devicePixelRatio: window.devicePixelRatio
                }
            };

            const localStorageStats = calcLocalStorageStats();
            const localStorageData = {};
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    try {
                        localStorageData[key] = JSON.parse(localStorage.getItem(key));
                    } catch (e) {
                        localStorageData[key] = localStorage.getItem(key);
                    }
                }
            } catch {
                // ignore
            }

            const runtime = {
                debugMode: !!this.app.debugMode,
                isDarkMode: !!this.app.isDarkMode,
                currentLayer: this.app.currentLayer,
                currentSearchMethod: this.app.currentSearchMethod,
                currentMode: this.app.currentMode,
                filterMode: !!this.app.filterMode,
                selectedMarkers: Array.isArray(this.app.selectedMarkers) ? this.app.selectedMarkers.map(m => m && m.id).filter(Boolean) : [],
                currentMarker: this.app.currentMarker ? { id: this.app.currentMarker.id, title: this.app.currentMarker.title } : null,
                currentConnection: this.app.currentConnection ? { id: this.app.currentConnection.id } : null,
                shareID: shareID || null
            };

            const appSummary = {
                markersCount: Array.isArray(this.app.markers) ? this.app.markers.length : 0,
                connectionsCount: Array.isArray(this.app.connections) ? this.app.connections.length : 0,
                dateNotesCount: this.app.dateNotes ? Object.keys(this.app.dateNotes).length : 0,
                historyCount: Array.isArray(this.app.history) ? this.app.history.length : 0,
                map: {
                    center: this.app.map && this.app.map.getCenter ? this.app.map.getCenter() : null,
                    zoom: this.app.map && this.app.map.getZoom ? this.app.map.getZoom() : null
                }
            };

            const logs = Array.isArray(window.__debugLogs) ? window.__debugLogs.slice(-200) : [];
            const errors = Array.isArray(window.__debugErrors) ? window.__debugErrors.slice(-50) : [];

            // 仍然保留原有“全量 appState”，方便深挖
            const appState = {
                markers: (this.app.markers || []).map(m => ({
                    id: m.id,
                    position: m.position,
                    title: m.title,
                    labels: m.labels,
                    logo: m.logo,
                    icon: m.icon,
                    createdAt: m.createdAt,
                    dateTimes: m.dateTimes
                })),
                connections: (this.app.connections || []).map(c => ({
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
                map: appSummary.map
            };

            return {
                envInfo,
                runtime,
                appSummary,
                localStorageStats,
                localStorage: localStorageData,
                logs,
                errors,
                appState
            };
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
            title.textContent = i18next.t('debug.title');
            title.style.cssText = 'margin: 0 0 20px 0; color: var(--text-primary, #333); font-size: 18px;';
            modalContent.appendChild(title);

            // 顶部操作区：过滤 + 复制/下载
            const actionsBar = document.createElement('div');
            actionsBar.className = 'debug-actions';

            const filterInput = document.createElement('input');
            filterInput.className = 'debug-filter-input';
            filterInput.type = 'text';
            filterInput.placeholder = i18next.t('debug.filter_placeholder');

            const clearBtn = document.createElement('button');
            clearBtn.className = 'debug-action-btn debug-action-btn-secondary';
            clearBtn.type = 'button';
            clearBtn.textContent = i18next.t('debug.clear_filter');

            const copyAllBtn = document.createElement('button');
            copyAllBtn.className = 'debug-action-btn';
            copyAllBtn.type = 'button';
            copyAllBtn.textContent = i18next.t('debug.copy_all');

            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'debug-action-btn';
            downloadBtn.type = 'button';
            downloadBtn.textContent = i18next.t('debug.download_json');

            actionsBar.appendChild(filterInput);
            actionsBar.appendChild(clearBtn);
            actionsBar.appendChild(copyAllBtn);
            actionsBar.appendChild(downloadBtn);
            modalContent.appendChild(actionsBar);

            // 收集数据（快照）
            const snapshot = this.buildDebugSnapshot();

            // 创建分组容器
            const groupsContainer = document.createElement('div');
            groupsContainer.id = 'debugGroupsContainer';

            // 创建 环境信息 分组
            const envGroup = this.createDebugGroup(
                i18next.t('debug.env_info'),
                snapshot.envInfo,
                'envInfo'
            );
            groupsContainer.appendChild(envGroup);

            // 创建 应用配置/运行状态 分组
            const runtimeGroup = this.createDebugGroup(
                i18next.t('debug.app_config'),
                snapshot.runtime,
                'runtime'
            );
            groupsContainer.appendChild(runtimeGroup);

            const summaryGroup = this.createDebugGroup(
                i18next.t('debug.status_overview'),
                snapshot.appSummary,
                'appSummary'
            );
            groupsContainer.appendChild(summaryGroup);

            // LocalStorage 统计分组（便于定位“缓存爆了/某个 key 过大”）
            const storageStatsGroup = this.createDebugGroup(
                i18next.t('debug.ls_stats'),
                snapshot.localStorageStats,
                'localStorageStats'
            );
            groupsContainer.appendChild(storageStatsGroup);

            // 创建 LocalStorage 分组
            const localStorageGroup = this.createDebugGroup(
                '💾 LocalStorage',
                snapshot.localStorage,
                'localStorage'
            );
            groupsContainer.appendChild(localStorageGroup);

            // 创建日志/错误分组（仅 debug=true 时安装 hooks）
            const logsGroup = this.createDebugGroup(
                i18next.t('debug.recent_logs'),
                snapshot.logs,
                'logs'
            );
            groupsContainer.appendChild(logsGroup);

            const errorsGroup = this.createDebugGroup(
                i18next.t('debug.recent_errors'),
                snapshot.errors,
                'errors'
            );
            groupsContainer.appendChild(errorsGroup);

            // 创建 AppState 分组
            const appStateGroup = this.createDebugGroup(
                i18next.t('debug.app_state'),
                snapshot.appState,
                'appState'
            );
            groupsContainer.appendChild(appStateGroup);

            let snapshotJSONCache = null;
            const getSnapshotJSON = () => {
                if (snapshotJSONCache) return snapshotJSONCache;
                snapshotJSONCache = safeStringify(snapshot);
                return snapshotJSONCache;
            };
            copyAllBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const snapshotJSON = getSnapshotJSON();
                this.copyText(snapshotJSON, (ok) => {
                    copyAllBtn.textContent = ok ? '已复制 ✅' : i18next.t('debug.copy_failed');
                    setTimeout(() => {
                        copyAllBtn.textContent = i18next.t('debug.copy_all');
                    }, 1500);
                });
            });

            downloadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const snapshotJSON = getSnapshotJSON();
                this.downloadText(`roadbook-debug-${Date.now()}.json`, snapshotJSON);
                downloadBtn.textContent = i18next.t('debug.downloaded');
                setTimeout(() => {
                    downloadBtn.textContent = i18next.t('debug.download_json');
                }, 1500);
            });

            const applyFilter = () => {
                const q = String(filterInput.value || '').trim().toLowerCase();

                // 规则：
                // 1) 先按“子项标题”过滤；
                // 2) 如果某个大分组下没有任何命中，则隐藏整个大分组，避免用户不知道命中在哪个模块；
                // 3) 如果搜索词命中“大分组标题”，则显示该分组并展开显示全部子项。

                const groups = groupsContainer.querySelectorAll('.debug-group');
                groups.forEach((group) => {
                    const groupTitleEl = group.querySelector('.debug-group-title');
                    const groupTitle = groupTitleEl ? String(groupTitleEl.textContent || '').toLowerCase() : '';
                    const groupMatched = !!q && groupTitle.includes(q);

                    const items = group.querySelectorAll('.debug-sub-group');
                    let visibleCount = 0;

                    items.forEach((el) => {
                        if (!q) {
                            el.style.display = '';
                            visibleCount++;
                            return;
                        }

                        if (groupMatched) {
                            // 命中大分组标题：不再过滤子项，全部展示
                            el.style.display = '';
                            visibleCount++;
                            return;
                        }

                        const titleEl = el.querySelector('.debug-sub-group-title');
                        const t = titleEl ? String(titleEl.textContent || '').toLowerCase() : '';
                        const show = t.includes(q);
                        el.style.display = show ? '' : 'none';
                        if (show) visibleCount++;
                    });

                    // 隐藏空大分组（仅在有搜索词且不命中分组标题时）
                    if (q && !groupMatched && visibleCount === 0) {
                        group.style.display = 'none';
                    } else {
                        group.style.display = '';
                    }
                });
            };

            filterInput.addEventListener('input', (e) => {
                e.stopPropagation();
                applyFilter();
            });

            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                filterInput.value = '';
                applyFilter();
            });

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
            } else if (groupName === 'envInfo') {
                icon.textContent = '🌐';
            } else if (groupName === 'runtime') {
                icon.textContent = '⚙️';
            } else if (groupName === 'appSummary') {
                icon.textContent = '📈';
            } else if (groupName === 'localStorageStats') {
                icon.textContent = '📦';
            } else if (groupName === 'logs') {
                icon.textContent = '🧾';
            } else if (groupName === 'errors') {
                icon.textContent = '💥';
            } else {
                icon.textContent = '📋';
            }

            const titleText = document.createElement('span');
            titleText.textContent = title.slice(2);

            const count = document.createElement('span');
            count.className = 'debug-count';
            count.textContent = i18next.t('debug.items_count', {count: Object.keys(data).length});
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
                emptyHint.textContent = i18next.t('debug.no_data');
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
                toggle.textContent = isExpanded ? '📁' : '📂';
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
            copyBtn.title = i18next.t('debug.copy_tooltip');

            // 把 title、toggle 和 copyBtn 添加到 header
            header.appendChild(titleSpan);
            header.appendChild(toggle);
            header.appendChild(copyBtn);

            const content = document.createElement('div');
            content.className = 'debug-sub-group-content'; // 默认折叠，不加 expanded

            let formattedCache = null;
            let isLoaded = false;
            const getFormatted = () => {
                if (formattedCache !== null) return formattedCache;
                formattedCache = formatValue(value);
                return formattedCache;
            };
            const ensureLoaded = () => {
                if (isLoaded) return;
                content.textContent = getFormatted();
                isLoaded = true;
            };
            // 懒加载：避免在弹窗打开时就 stringify 巨大对象，导致卡顿
            content.textContent = i18next.t('debug.click_to_load');

            // 点击 header 切换展开/折叠
            header.addEventListener('click', (e) => {
                if (e.target === copyBtn) return; // 点击复制按钮不触发展开/折叠
                e.stopPropagation();
                const willExpand = !content.classList.contains('expanded');
                content.classList.toggle('expanded');
                toggle.textContent = willExpand ? '📂' : '📁';
                if (willExpand) {
                    ensureLoaded();
                }
            });

            // 复制按钮点击事件
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const text = getFormatted();
                this.copyText(text, (ok) => {
                    copyBtn.textContent = ok ? '✅' : '❌';
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
