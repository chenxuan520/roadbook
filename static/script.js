var apiBaseUrl = (() => {
    // 1. 优先使用用户在浏览器中自定义的设置 (localStorage)
    const custom = localStorage.getItem('custom_api_base_url');
    if (custom) return custom;

    // 2. 其次使用构建时/运行时注入的全局配置 (CI/CD注入)
    if (typeof window.API_BASE_URL !== 'undefined') {
        return window.API_BASE_URL;
    }

    // 3. 最后根据当前环境自动判断
    const hostname = window.location.hostname || '';
    const protocol = window.location.protocol || '';

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || protocol === 'file:') {
        return 'http://127.0.0.1:5436';
    } else {
        return window.location.origin;
    }
})();

// 从页面 DOM 中获取前端展示的版本号（由 index.html + update_version.sh 写入）
function getAppVersionFromDOM() {
    try {
        const el = document.getElementById('version-display');
        if (!el) return 'unknown';

        // 优先使用文本内容
        const text = (el.textContent || '').trim();
        if (text) return text;

        // 其次尝试 data-version 等属性
        const dataVersion = (el.getAttribute('data-version') || '').trim();
        if (dataVersion) return dataVersion;

        return 'unknown';
    } catch (e) {
        return 'unknown';
    }
}

// 供其他脚本使用的全局版本常量
window.ROADBOOK_APP_VERSION = getAppVersionFromDOM();

class RoadbookApp {
    constructor() {
        this.map = null;
        this.markers = [];
        this.connections = [];
        this.labels = [];
        this.currentMode = 'view';
        this.selectedMarkers = [];
        this.currentIcon = {
            type: 'default',
            icon: '📍',
            color: '#667eea'
        };
        this.searchMarker = null;  // 搜索结果标记点
        this.searchTimeout = null; // 搜索延时定时器
        this.searchPopupTimeout = null; // 搜索弹窗定时器
        this.currentSearchMethod = 'auto'; // 当前搜索方式：auto, nominatim, overpass, photon, mapsearch
        this.tooltip = null; // 连接线工具提示
        this.connectionLabelTooltip = null; // 连接线标注工具提示
        this.markerTooltip = null; // 标记点工具提示
        this.searchResults = null; // 搜索结果对象
        this.currentMarker = null; // 当前选中的标记点
        this.currentConnection = null; // 当前选中的连接线
        this.filterMode = false; // 是否处于筛选模式
        this.filteredDate = null; // 当前筛选的日期
        this.history = []; // 操作历史栈
        this.historyLimit = 50; // 历史记录最大数量
        this.pendingConnectionRestores = []; // 撤销删除标记点时，延迟恢复的连接线（等待两端点都被恢复）
        this.dateNotes = {}; // 日期备注信息
        this.hoverTimeout = null; // 聚焦按钮的悬浮计时器
        this.lastDateRange = null; // 上次使用的日期范围
        this.isDarkMode = false; // 主题模式状态
        this.debugMode = false; // 调试模式状态

        this.isDraggingLine = false; // 是否正在拖拽连接线
        this.dragStartMarker = null; // 拖拽连接线的起始标记点
        this.dragPreviewLine = null; // 拖拽时的预览线
        this.dragPreviewArrow = null; // 拖拽时的预览箭头

        // 框选功能状态
        this.isSelecting = false; // 是否正在框选
        this.selectionStartLatLng = null; // 框选起始坐标
        this.selectionRectangle = null; // 框选矩形

        this.searchProviderOriginalTexts = new Map();

        // PWA 安装提示相关
        this.deferredPrompt = null;

        // 监听 PWA 安装事件
        window.addEventListener('beforeinstallprompt', (e) => {
            // 阻止 Chrome 67 及更早版本自动显示安装提示
            e.preventDefault();
            // 保存事件以便稍后触发
            this.deferredPrompt = e;
            console.log('PWA 安装提示已拦截，等待用户操作');
        });

        window.addEventListener('appinstalled', () => {
            console.log('PWA 已安装');
            this.deferredPrompt = null;
        });

        this.init();
    }


    init() {
        const urlParams = new URLSearchParams(window.location.search);
        this.debugMode = urlParams.get('debug') === 'true';

        // 检测是否为移动设备
        // if (this.isMobileDevice()) {
        //     this.showSwalAlert('设备提示', '当前界面不支持手机端编辑功能，请使用电脑访问以获得完整体验。导出的路书可在手机端正常查看。', 'info');
        // }

        // 初始化主题
        this.initTheme();

        // 初始化移动端适配
        this.initMobileFeatures();
        this.preventBrowserZoom();

        // 先尝试从本地存储加载设置，以获取保存的地图源和搜索方式
        const cachedData = this.loadSettingsFromCache();
        if (cachedData) {
            // 如果缓存中有数据，使用缓存的设置
            this.currentLayer = cachedData.currentLayer || 'osm';
            this.currentSearchMethod = cachedData.currentSearchMethod || 'auto';
        } else {
            // 否则使用默认设置
            this.currentLayer = 'gaode';  // 改为高德地图
            this.currentSearchMethod = 'auto';
        }

        // 检查URL中是否有分享ID参数
        const shareID = urlParams.get('shareID');

        // 首先进行正常的地图初始化（无论是否有分享ID）
        this.initMap();
        if (this.debugMode) {
            this.initDebugFeatures();
        }
        this.bindEvents();
        this.bindExpandModalEvents();
        this.addSearchProviderComments();

        if (shareID) {
            // 如果有分享ID，先正常加载本地数据，然后处理分享数据
            this.loadFromLocalStorage(); // 先加载本地缓存
            this.updateSearchInputState(); // 初始化搜索框状态

            // 检查本地缓存
            const hasLocalData = this.checkLocalCache();
            if (hasLocalData) {
                // 本地有数据，询问用户是否覆盖
                this.askUserToImportSharedData(shareID);
            } else {
                // 本地无数据，直接导入分享数据
                this.importSharedData(shareID);
            }
            // 清除分享参数，避免重复触发
            window.history.replaceState({}, document.title, window.location.pathname);
        } else {
            // 正常初始化流程
            this.loadFromLocalStorage(); // 初始化时加载本地缓存
            this.updateSearchInputState(); // 初始化搜索框状态

            // 检查是否是首次进入（没有标记点、连接线和日期备注）
            const savedData = localStorage.getItem('roadbookData');
            if (!savedData) {
                // 首次进入，尝试获取用户位置并定位
                this.locateUserAndFitView();
            }
        }
    }

    // 自动定位用户并聚焦到用户位置（仅在首次进入时）
    locateUserAndFitView() {
        if (!navigator.geolocation) {
            console.log('浏览器不支持地理定位');
            // 如果浏览器不支持定位，则使用默认位置（北京）
            this.map.setView([39.90923, 116.397428], 10); // 北京天安门
            return;
        }

        console.log('正在尝试获取用户位置...');

        // 先显示一个加载提示
        const loadingMessage = document.createElement('div');
        loadingMessage.id = 'geolocation-loading';
        loadingMessage.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 15px 25px;
            border-radius: 8px;
            z-index: 10000;
            font-size: 16px;
            text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        loadingMessage.innerHTML = `
            <div style="margin-bottom: 8px;">📍 正在获取您的位置...</div>
            <div style="font-size: 12px; opacity: 0.8;">请允许位置访问权限</div>
        `;
        document.body.appendChild(loadingMessage);

        // 设置较短的超时时间来移除加载提示，避免UI阻塞
        const timeoutId = setTimeout(() => {
            const loadingEl = document.getElementById('geolocation-loading');
            if (loadingEl) {
                document.body.removeChild(loadingEl);
                console.log('获取位置超时，使用默认位置');
                // 超时后使用默认位置
                this.map.setView([39.90923, 116.397428], 10); // 北京天安门

                // 在默认位置添加一个临时标记点来显示定位结果
                if (this.searchMarker) {
                    this.map.removeLayer(this.searchMarker);
                }

                this.searchMarker = L.marker([39.90923, 116.397428])
                    .addTo(this.map);
            }
        }, 3000); // 3秒超时

        navigator.geolocation.getCurrentPosition(
            // 成功回调
            (position) => {
                // 清除超时定时器
                clearTimeout(timeoutId);

                const {latitude, longitude} = position.coords;
                console.log(`获取到用户位置: 纬度=${latitude}, 经度=${longitude}`);

                // 移除加载提示
                const loadingEl = document.getElementById('geolocation-loading');
                if (loadingEl) {
                    document.body.removeChild(loadingEl);
                }

                // 设置地图视图到用户位置，使用中等缩放级别
                this.map.setView([latitude, longitude], 13);

                // 在用户位置添加一个临时标记点来显示定位结果
                if (this.searchMarker) {
                    this.map.removeLayer(this.searchMarker);
                }

                this.searchMarker = L.marker([latitude, longitude])
                    .addTo(this.map);

                console.log(`地图已定位到用户位置: [${latitude}, ${longitude}]`);
            },
            // 失败回调
            (error) => {
                // 清除超时定时器
                clearTimeout(timeoutId);

                console.log('获取用户位置失败:', error.message);

                // 移除加载提示
                const loadingEl = document.getElementById('geolocation-loading');
                if (loadingEl) {
                    document.body.removeChild(loadingEl);
                }

                // 获取失败时，使用默认位置（北京）
                this.map.setView([39.90923, 116.397428], 10); // 北京天安门

                // 在默认位置添加一个临时标记点来显示定位结果
                if (this.searchMarker) {
                    this.map.removeLayer(this.searchMarker);
                }

                this.searchMarker = L.marker([39.90923, 116.397428])
                    .addTo(this.map);

                console.log('使用默认位置（北京）');
            },
            {
                enableHighAccuracy: false,  // 禁用高精度以加快响应（可能无法在某些环境下工作）
                timeout: 2500,             // 2.5秒超时（略短于UI超时时间）
                maximumAge: 60000          // 使用1分钟内的缓存位置
            }
        );
    }

    // 询问用户是否导入分享数据
    askUserToImportSharedData(shareID) {
        // 延迟显示确认对话框，确保页面完全加载
        setTimeout(() => {
            this.showSwalConfirm('发现分享链接', '检测到分享链接，当前本地已有数据。是否导入分享数据？这将覆盖当前本地数据。', '导入', '取消')
                .then(result => {
                    if (result.isConfirmed) {
                        this.importSharedData(shareID);
                    } else {
                        // 用户选择不导入，正常初始化
                        this.showSwalAlert('提示', '已取消导入分享数据', 'info');
                    }
                })
                .catch(error => {
                    console.error('显示确认对话框失败:', error);
                    // 如果显示对话框失败，继续正常初始化
                    this.showSwalAlert('提示', '已取消导入分享数据', 'info');
                });
        }, 1000); // 延迟1秒，确保所有UI元素都加载完成
    }

    // 导入分享数据
    async importSharedData(shareID) {
        try {
            // 显示加载提示（延迟显示，确保UI已经初始化）
            setTimeout(() => {
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        title: '正在导入',
                        text: '正在加载分享数据...',
                        icon: 'info',
                        showConfirmButton: false,
                        allowOutsideClick: false,
                        didOpen: () => {
                            Swal.showLoading();
                        }
                    });
                }
            }, 100);

            // 调用分享接口获取数据
            const response = await this.fetchShareData(shareID);

            if (response && response.plan && response.plan.content) {
                // 提取实际的路线图数据内容
                const shareContent = response.plan.content;

                // 确保数据结构完整，提供默认值
                if (!shareContent.markers) {
                    shareContent.markers = [];
                }
                if (!shareContent.connections) {
                    shareContent.connections = [];
                }
                if (!shareContent.labels) {
                    shareContent.labels = [];
                }
                if (!shareContent.dateNotes) {
                    shareContent.dateNotes = {};
                }

                // 验证数据结构
                if (!Array.isArray(shareContent.markers)) {
                    throw new Error('分享数据中的markers必须是数组');
                }
                if (!Array.isArray(shareContent.connections)) {
                    throw new Error('分享数据中的connections必须是数组');
                }

                // 加载分享的数据
                this.loadRoadbook(shareContent, false);

                // 保存到本地缓存
                this.saveToLocalStorage();

                // 关闭加载提示并显示成功消息
                if (typeof Swal !== 'undefined') {
                    Swal.close();
                }

                setTimeout(() => {
                    this.showSwalAlert('成功', `分享数据导入成功！导入了 ${shareContent.markers.length} 个标记点和 ${shareContent.connections.length} 条连接线`, 'success');
                }, 200);

                // 继续正常初始化流程
                this.continueNormalInit();
            } else {
                throw new Error('分享数据格式不正确，缺少plan或plan.content字段');
            }
        } catch (error) {
            // 关闭加载提示
            if (typeof Swal !== 'undefined') {
                Swal.close();
            }

            this.showSwalAlert('错误', '导入分享数据失败: ' + error.message, 'error');

            // 导入失败，继续正常初始化
            this.continueNormalInit();
        }
    }

    // 从分享接口获取数据
    async fetchShareData(shareID) {
        try {
            // 构建分享接口URL
            const baseUrl = this.getShareApiBaseUrl();
            const shareUrl = `${baseUrl}/share/plans/${shareID}`;

            const response = await fetch(shareUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `获取分享数据失败: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('获取分享数据失败:', error);
            throw error;
        }
    }

    // 获取分享API基础URL
    getShareApiBaseUrl() {
        return apiBaseUrl + '/api/v1';
    }

    // 继续正常初始化流程
    continueNormalInit() {
        this.initMap();
        this.bindEvents();
        this.loadFromLocalStorage(); // 初始化时加载本地缓存
        this.updateSearchInputState(); // 初始化搜索框状态

        // 检查是否是首次进入（没有标记点、连接线和日期备注）
        const savedData = localStorage.getItem('roadbookData');
        if (!savedData) {
            // 首次进入，尝试获取用户位置并定位
            this.locateUserAndFitView();
        }
    }

    isBrowserZoomShortcut(event) {
        if (!event || (!event.ctrlKey && !event.metaKey)) {
            return false;
        }

        const key = String(event.key || '').toLowerCase();
        return ['+', '=', '-', '_', '0'].includes(key);
    }

    preventBrowserZoom() {
        if (this.browserZoomPreventionBound) {
            return;
        }
        this.browserZoomPreventionBound = true;

        document.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
            }
        }, {passive: false, capture: true});

        document.addEventListener('keydown', (e) => {
            if (this.isBrowserZoomShortcut(e)) {
                e.preventDefault();
            }
        }, true);

        ['gesturestart', 'gesturechange', 'gestureend'].forEach(eventName => {
            document.addEventListener(eventName, (e) => {
                e.preventDefault();
            }, {passive: false, capture: true});
        });
    }

    bindEvents() {
        // 全新的拖拽连接线逻辑，使用原生DOM事件以避免冲突
        const mapContainer = this.map.getContainer();

        mapContainer.addEventListener('mousedown', (e) => {
            if (this.currentMode !== 'view' || e.button !== 2) {
                return;
            }

            const latlng = this.map.mouseEventToLatLng(e);
            const startMarker = this.getMarkerAt(latlng);

            if (startMarker) {
                e.preventDefault();
                e.stopPropagation();

                this.isDraggingLine = true;
                this.dragStartMarker = startMarker;
                this.map.dragging.disable();

                const previewColorType = 'preview'; // 使用预览颜色
                const previewLatLng = [latlng.lat, latlng.lng];

                this.dragPreviewLine = L.polyline([startMarker.position, previewLatLng], {
                    color: this.getTransportColor(previewColorType),
                    weight: 3,
                    dashArray: '5, 10'
                }).addTo(this.map);

                this.dragPreviewArrow = this.createArrowHead(startMarker.position, previewLatLng, previewColorType);
                this.dragPreviewArrow.addTo(this.map);
            } else {
                // 框选逻辑
                e.preventDefault(); // 阻止默认右键菜单
                e.stopPropagation();

                this.isSelecting = true;
                this.selectionStartLatLng = latlng;
                this.map.dragging.disable(); // 禁用地图拖拽

                // 初始化虚线框
                this.selectionRectangle = L.rectangle([latlng, latlng], {
                    color: '#3388ff',
                    weight: 2,
                    dashArray: '5, 5',
                    fillOpacity: 0.2
                }).addTo(this.map);
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isDraggingLine) {
                const latlng = this.map.mouseEventToLatLng(e);
                const previewLatLng = [latlng.lat, latlng.lng];

                if (this.dragPreviewLine) {
                    this.dragPreviewLine.setLatLngs([this.dragStartMarker.position, previewLatLng]);
                }

                if (this.dragPreviewArrow) {
                    this.dragPreviewArrow.remove();
                    const previewColorType = 'preview'; // 使用预览颜色
                    this.dragPreviewArrow = this.createArrowHead(this.dragStartMarker.position, previewLatLng, previewColorType);
                    this.dragPreviewArrow.addTo(this.map);
                }
            } else if (this.isSelecting) {
                const latlng = this.map.mouseEventToLatLng(e);
                if (this.selectionRectangle) {
                    const bounds = L.latLngBounds(this.selectionStartLatLng, latlng);
                    this.selectionRectangle.setBounds(bounds);
                }
            }
        });

        document.addEventListener('mouseup', (e) => {
            if (this.isDraggingLine) {
                if (this.dragPreviewLine) {
                    this.dragPreviewLine.remove();
                    this.dragPreviewLine = null;
                }
                if (this.dragPreviewArrow) {
                    this.dragPreviewArrow.remove();
                    this.dragPreviewArrow = null;
                }

                const latlng = this.map.mouseEventToLatLng(e);
                const endMarker = this.getMarkerAt(latlng);

                if (endMarker && endMarker.id !== this.dragStartMarker.id) {
                    // Pass null for transportType to trigger auto-calculation based on distance
                    this.createConnection(this.dragStartMarker, endMarker, null);
                }

                this.isDraggingLine = false;
                this.dragStartMarker = null;
                this.map.dragging.enable();
            } else if (this.isSelecting) {
                const latlng = this.map.mouseEventToLatLng(e);
                const bounds = L.latLngBounds(this.selectionStartLatLng, latlng);

                // 移除视觉元素
                if (this.selectionRectangle) {
                    this.selectionRectangle.remove();
                    this.selectionRectangle = null;
                }

                this.isSelecting = false;
                this.selectionStartLatLng = null;
                this.map.dragging.enable();

                // 查找框选中的标记点
                const selectedMarkers = this.markers.filter(marker => {
                    return bounds.contains(L.latLng(marker.position));
                });

                if (selectedMarkers.length > 0) {
                    this.showBatchOperationModal(selectedMarkers);
                }
            }
        });


        // 工具栏按钮事件
        const addMarkerBtn = document.getElementById('addMarkerBtn');
        if (addMarkerBtn) {
            addMarkerBtn.addEventListener('click', () => {
                this.setMode('addMarker');
            });
        }

        const connectMarkersBtn = document.getElementById('connectMarkersBtn');
        if (connectMarkersBtn) {
            connectMarkersBtn.addEventListener('click', () => {
                this.showConnectModal();
            });
        }

        // 绑定导出按钮事件，现在需要处理下拉菜单
        const exportDropdownBtn = document.getElementById('exportDropdownBtn');
        const exportDropdownContent = document.getElementById('exportDropdownContent');
        const exportBtn = document.getElementById('exportBtn');
        const exportHtmlBtn = document.getElementById('exportHtmlBtn');
        const exportTxtBtn = document.getElementById('exportTxtBtn');
        const exportIcsBtn = document.getElementById('exportIcsBtn');
        const exportImgBtn = document.getElementById('exportImgBtn');


        // 下拉按钮点击事件 - 显示/隐藏下拉菜单
        if (exportDropdownBtn) {
            exportDropdownBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                exportDropdownContent.classList.toggle('show');
            });
        }

        // 点击导出JSON按钮
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.exportRoadbook();
                // 隐藏下拉菜单
                if (exportDropdownContent) {
                    exportDropdownContent.classList.remove('show');
                }
            });
        }

        // 点击导出HTML按钮
        if (exportHtmlBtn) {
            exportHtmlBtn.addEventListener('click', () => {
                if (window.htmlExporter) {
                    window.htmlExporter.exportToHtml();
                } else {
                    console.error('HTML Exporter not found');
                }
                // 隐藏下拉菜单
                if (exportDropdownContent) {
                    exportDropdownContent.classList.remove('show');
                }
            });
        }

        // 点击导出TXT按钮
        if (exportTxtBtn) {
            exportTxtBtn.addEventListener('click', () => {
                // 隐藏下拉菜单
                if (exportDropdownContent) {
                    exportDropdownContent.classList.remove('show');
                }

                Swal.fire({
                    title: '导出为 TXT',
                    text: '导出的 TXT 文件主要用于大模型分析，无法重新导入。',
                    icon: 'info',
                    showCancelButton: true,
                    showDenyButton: true,
                    confirmButtonText: '导出文件',
                    denyButtonText: '复制到剪贴板',
                    cancelButtonText: '取消',
                    confirmButtonColor: '#667eea',
                    denyButtonColor: '#32b47c',
                    cancelButtonColor: '#6c757d'
                }).then((result) => {
                    if (result.isConfirmed) {
                        // 用户点击“确认导出”
                        if (window.htmlExporter) {
                            window.htmlExporter.exportToTxt();
                            this.showSwalAlert('已开始下载', 'TXT 文件已开始下载。', 'success');
                        } else {
                            console.error('HTML Exporter not found');
                        }
                    } else if (result.isDenied) {
                        // 用户点击“复制到剪贴板”
                        if (window.htmlExporter) {
                            const txtContent = window.htmlExporter.exportToTxt(true);
                            navigator.clipboard.writeText(txtContent).then(() => {
                                this.showSwalAlert('成功', '行程安排已复制到剪贴板！', 'success');
                            }).catch(err => {
                                console.error('复制失败:', err);
                                this.showSwalAlert('失败', '复制失败，请检查浏览器权限或手动导出。', 'error');
                            });
                        } else {
                            console.error('HTML Exporter not found');
                        }
                    }
                });
            });
        }

        // 点击导出ICS按钮
        if (exportIcsBtn) {
            exportIcsBtn.addEventListener('click', () => {
                this.exportToIcs();
                // 隐藏下拉菜单
                if (exportDropdownContent) {
                    exportDropdownContent.classList.remove('show');
                }
            });
        }

        // 点击导出图片按钮
        if (exportImgBtn) {
            exportImgBtn.addEventListener('click', () => {
                window.htmlExporter.showExportThemeSelector();
                // 隐藏下拉菜单
                if (exportDropdownContent) {
                    exportDropdownContent.classList.remove('show');
                }
            });
        }

        // 点击页面其他地方隐藏下拉菜单
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.dropdown')) {
                if (exportDropdownContent && exportDropdownContent.classList.contains('show')) {
                    exportDropdownContent.classList.remove('show');
                }
            }
        });


        const importBtn = document.getElementById('importBtn');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                const importFile = document.getElementById('importFile');
                if (importFile) {
                    // 每次点击前清空 value，确保选择同一个文件也能触发 change 事件
                    importFile.value = '';
                    importFile.click();
                }
            });
        }

        const importFile = document.getElementById('importFile');
        if (importFile) {
            importFile.addEventListener('change', (e) => {
                this.importRoadbook(e.target.files[0]);
            });
        }

        const mapSourceSelect = document.getElementById('mapSourceSelect');
        if (mapSourceSelect) {
            mapSourceSelect.addEventListener('change', (e) => {
                // 只有在不是UI更新时才执行切换和保存操作
                if (!this.updatingUI) {
                    this.switchMapSource(e.target.value);
                    // 保存到本地存储以确保刷新后状态保持
                    this.saveToLocalStorage();
                }
            });
        }

        const clearCacheBtn = document.getElementById('clearCacheBtn');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', () => {
                this.clearCache();
            });
        }

        // 搜索功能
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.searchLocation(searchInput.value);
                }
            });

            // 实时搜索功能（在用户输入时显示结果）
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                if (query) {
                    // 延迟搜索，避免频繁请求
                    clearTimeout(this.searchTimeout);
                    this.searchTimeout = setTimeout(() => {
                        this.searchLocation(query);
                    }, 300);
                } else {
                    // 如果输入为空，隐藏搜索结果
                    const searchResults = document.getElementById('searchResults');
                    if (searchResults) {
                        searchResults.style.display = 'none';
                    }
                }
            });
        }

        // 搜索方式选择事件
        const searchMethodSelect = document.getElementById('searchMethodSelect');
        if (searchMethodSelect) {
            searchMethodSelect.addEventListener('change', (e) => {
                // 只有在不是UI更新时才执行切换和保存操作
                if (!this.updatingUI) {
                    this.currentSearchMethod = e.target.value;
                    console.log(`搜索方式已切换为: ${this.currentSearchMethod}`);
                    // 保存到本地存储以确保刷新后状态保持
                    this.saveToLocalStorage();
                }
            });

            // Add a one-time mousedown listener to run the latency test
            searchMethodSelect.addEventListener('mousedown', () => {
                this.updateProviderIcons();
            }, {once: true});
        }

        // 点击页面其他地方隐藏搜索结果
        document.addEventListener('click', (e) => {
            const searchResults = document.getElementById('searchResults');
            const searchBox = document.querySelector('.search-box');
            if (searchResults && searchBox &&
                !searchBox.contains(e.target) &&
                !searchResults.contains(e.target)) {
                searchResults.style.display = 'none';
            }
        });

        // 标记点详情面板中的图标更换按钮事件
        const changeIconBtn = document.getElementById('changeIconBtn');
        if (changeIconBtn) {
            changeIconBtn.addEventListener('click', () => {
                this.showIconModal();
            });
        }

        const confirmIcon = document.getElementById('confirmIcon');
        if (confirmIcon) {
            confirmIcon.addEventListener('click', () => {
                this.confirmIconSelection();
            });
        }

        // 标记点详情面板关闭按钮
        const closeMarkerDetailBtn = document.getElementById('closeMarkerDetailBtn');
        if (closeMarkerDetailBtn) {
            closeMarkerDetailBtn.addEventListener('click', () => {
                this.hideMarkerDetail();
            });
        }

        // 连接线详情面板关闭按钮
        const closeConnectionDetailBtn = document.getElementById('closeConnectionDetailBtn');
        if (closeConnectionDetailBtn) {
            closeConnectionDetailBtn.addEventListener('click', () => {
                this.hideConnectionDetail();
            });
        }

        // --- 全局实时保存事件绑定 ---
        const realtimeSaveHandler = () => {
            if (this.currentMarker) {
                this.saveMarkerDetail();
            } else if (this.currentConnection) {
                this.saveConnectionDetail();
            } else if (this.currentDate) {
                this.saveDateNotes();
            }
        };

        ['markerNameInput', 'markerLabelsInput', 'markerLogoInput'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', realtimeSaveHandler);
        });
        ['connectionDuration', 'connectionLabelsInput', 'connectionLogoInput'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', realtimeSaveHandler);
        });
        ['connectionDateInput', 'connectionStartMarker', 'connectionEndMarker'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', realtimeSaveHandler);
        });
        const dateNotesInputForSave = document.getElementById('dateNotesInput');
        if (dateNotesInputForSave) dateNotesInputForSave.addEventListener('input', realtimeSaveHandler);
        // --- 全局实时保存事件绑定结束 ---

        // 连接线详情面板中的交通方式按钮事件（仅作用于连接线详情面板，避免影响连接弹窗）
        const connectionDetailPanel = document.getElementById('connectionDetailPanel');
        if (connectionDetailPanel) {
            connectionDetailPanel.querySelectorAll('.transport-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (!this.currentConnection) return;

                    connectionDetailPanel.querySelectorAll('.transport-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    const transportType = btn.dataset.transport;
                    this.updateConnectionTransport(this.currentConnection, transportType);
                    this.saveConnectionDetail();
                });
            });
        }

        // 图标选项点击事件（仅作用于图标选择弹窗）
        const iconModal = document.getElementById('iconModal');
        if (iconModal) {
            iconModal.querySelectorAll('.icon-option').forEach(option => {
                option.addEventListener('click', () => {
                    iconModal.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
                    option.classList.add('selected');
                });
            });
        }

        // 连接弹窗中的交通方式按钮点击事件（仅作用于连接弹窗）
        const connectModal = document.getElementById('connectModal');
        if (connectModal) {
            connectModal.querySelectorAll('.transport-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    connectModal.querySelectorAll('.transport-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    const transportType = btn.dataset.transport;
                    const transportTypeInput = document.getElementById('transportType');
                    if (transportTypeInput) transportTypeInput.value = transportType;
                });
            });
        }

        // 模态框事件
        const closeBtn = document.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.closeModals();
            });
        }

        const startMarkerSelect = document.getElementById('startMarker');
        if (startMarkerSelect) {
            startMarkerSelect.addEventListener('change', () => this.updateRecommendedTransportInModal());
        }
        const endMarkerSelect = document.getElementById('endMarker');
        if (endMarkerSelect) {
            endMarkerSelect.addEventListener('change', () => this.updateRecommendedTransportInModal());
        }

        const confirmConnect = document.getElementById('confirmConnect');
        if (confirmConnect) {
            confirmConnect.addEventListener('click', () => {
                this.connectMarkers();
            });
        }


        // NOTE: 已将 icon-option / transport-btn 的事件监听做了作用域拆分与去重，避免重复绑定与互相干扰

        // 详情面板事件
        const closeDetailBtn = document.getElementById('closeDetailBtn');
        if (closeDetailBtn) {
            closeDetailBtn.addEventListener('click', () => {
                this.hideMarkerDetail();
            });
        }

        // saveMarkerBtn listener removed for real-time save

        // 为markerLabelsInput添加粘贴和输入事件监听器
        const markerLabelsInput = document.getElementById('markerLabelsInput');
        if (markerLabelsInput) {
            markerLabelsInput.addEventListener('paste', (e) => this.handleMarkerLabelsPaste(e));
            markerLabelsInput.addEventListener('input', () => {
                const targetContainer = document.getElementById('markerLabelsLinks');
                this.updateLinkPreview(markerLabelsInput, targetContainer);
            });
        }


        // saveConnectionBtn listener removed for real-time save

        // 为connectionLabelsInput添加粘贴和输入事件监听器
        const connectionLabelsInput = document.getElementById('connectionLabelsInput');
        if (connectionLabelsInput) {
            connectionLabelsInput.addEventListener('paste', (e) => this.handleConnectionLabelsPaste(e));
            connectionLabelsInput.addEventListener('input', () => {
                const targetContainer = document.getElementById('connectionLabelsLinks');
                this.updateLinkPreview(connectionLabelsInput, targetContainer);
            });
        }


        const deleteConnectionBtn = document.getElementById('deleteConnectionBtn');
        if (deleteConnectionBtn) {
            deleteConnectionBtn.addEventListener('click', () => {
                this.deleteCurrentConnection();
            });
        }

        const deleteMarkerBtn = document.getElementById('deleteMarkerBtn');
        if (deleteMarkerBtn) {
            deleteMarkerBtn.addEventListener('click', () => {
                this.deleteCurrentMarker();
            });
        }

        // 添加时间点按钮事件
        const addDateTimeBtn = document.getElementById('addDateTimeBtn');
        if (addDateTimeBtn) {
            addDateTimeBtn.addEventListener('click', () => {
                this.addMarkerDateTime();
            });
        }

        // 点击模态框外部关闭
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModals();
            }
        });

        // 地图控制按钮事件 - 调整视窗按钮
        const fitViewBtn = document.getElementById('fitViewBtn');
        if (fitViewBtn) {
            fitViewBtn.addEventListener('click', () => {
                const picker = document.getElementById('dateRangePicker');
                // 如果日期选择器可见，则优先处理日期范围
                if (picker && picker.style.display !== 'none') {
                    const startDate = document.getElementById('startDate').value;
                    const endDate = document.getElementById('endDate').value;

                    if (startDate && endDate) {
                        // 保存用户选择的日期范围，以便下次悬停时恢复
                        this.lastDateRange = { start: startDate, end: endDate };
                        this.fitViewByDateRange(startDate, endDate);
                        picker.style.display = 'none'; // 操作后隐藏
                    } else {
                        // 如果日期不完整，提示用户
                        this.showSwalAlert('提示', '请选择完整的起始和结束日期以进行聚焦。', 'info');
                    }
                } else {
                    // 否则，执行默认的全局聚焦
                    this.handleFitViewClick();
                }
            });

            // 添加悬浮事件
            fitViewBtn.addEventListener('mouseover', () => {
                clearTimeout(this.hoverTimeout); // 清除可能存在的计时器
                this.hoverTimeout = setTimeout(() => {
                    const picker = document.getElementById('dateRangePicker');
                    // 如果已经打开则不执行任何操作
                    if (picker.style.display === 'flex') return;

                    const startDateInput = document.getElementById('startDate');
                    const endDateInput = document.getElementById('endDate');

                    if (this.lastDateRange && this.lastDateRange.start && this.lastDateRange.end) {
                        // 如果有保存的日期范围，则使用它
                        startDateInput.value = this.lastDateRange.start;
                        endDateInput.value = this.lastDateRange.end;
                    } else {
                        // 默认逻辑：从所有点的最早日期到所有点的最晚日期；如果没有点则回退为最近一个月
                        let earliest = null;
                        let latest = null;
                        const updateRange = (dt) => {
                            if (!dt) return;
                            const d = new Date(dt);
                            if (isNaN(d.getTime())) return;
                            if (!earliest || d < earliest) earliest = d;
                            if (!latest || d > latest) latest = d;
                        };

                        // 遍历标记点的时间
                        this.markers.forEach(m => {
                            if (Array.isArray(m.dateTimes) && m.dateTimes.length > 0) {
                                m.dateTimes.forEach(updateRange);
                            } else {
                                updateRange(m.dateTime);
                            }
                        });

                        // 遍历连接线的时间
                        this.connections.forEach(c => updateRange(c.dateTime));

                        if (earliest && latest) {
                            const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                            if (startDateInput) startDateInput.value = toDateStr(earliest);
                            if (endDateInput) endDateInput.value = toDateStr(latest);
                        } else {
                            // 没有任何点：回退为最近一个月
                            const endDate = new Date();
                            const startDate = new Date();
                            startDate.setMonth(startDate.getMonth() - 1);

                            if (startDateInput && typeof startDateInput.valueAsDate !== 'undefined') {
                                startDateInput.valueAsDate = startDate;
                            } else if (startDateInput) {
                                startDateInput.value = startDate.toISOString().split('T')[0];
                            }

                            if (endDateInput && typeof endDateInput.valueAsDate !== 'undefined') {
                                endDateInput.valueAsDate = endDate;
                            } else if (endDateInput) {
                                endDateInput.value = endDate.toISOString().split('T')[0];
                            }
                        }
                    }

                    picker.style.display = 'flex';
                }, 1000); // 1秒后显示
            });

            fitViewBtn.addEventListener('mouseout', () => {
                clearTimeout(this.hoverTimeout);
            });
        }

        // 添加键盘事件监听器
        document.addEventListener('keydown', (e) => {
            // 添加一个保护，以防 e.key 未定义（可能由某些浏览器扩展或代理脚本引起）
            if (!e || !e.key) {
                return;
            }

            // 检查是否按下Ctrl+Z（或Cmd+Z）且没有在输入框中输入
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' &&
                !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault(); // 阻止浏览器默认的撤销操作
                this.undo(); // 执行撤销
            }
            // 检查是否按下A键添加标记点
            else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'a' &&
                !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.setMode('addMarker'); // 进入添加标记点模式
            }
            // 检查是否按下C键连接标记点
            else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'c' &&
                !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.showConnectModal(); // 打开连接标记点界面
            }
            // 检查是否按下H键或?键显示帮助
            else if (!e.ctrlKey && !e.metaKey && (e.key.toLowerCase() === 'h' || e.key === '?') &&
                !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.showHelpModal(); // 显示帮助弹窗
            }
            // 检查是否按下D键、Backspace键或Delete键删除选中的标记点或连接线
            else if (!e.ctrlKey && !e.metaKey && (e.key.toLowerCase() === 'd' || e.key === 'Backspace' || e.key === 'Delete') &&
                !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.deleteCurrentElement(); // 删除当前选中的元素
            }
            // 检查是否按下F键自动调整视窗
            else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'f' &&
                !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.handleFitViewClick(); // 执行视窗调整（与右上角按钮相同的功能）
            }
            // 检查是否按下/键聚焦到搜索框
            else if (!e.ctrlKey && !e.metaKey && e.key === '/' &&
                !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                const searchInput = document.getElementById('searchInput');
                if (searchInput && !searchInput.disabled) {
                    // 如果搜索框已有内容，则清空
                    if (searchInput.value.trim() !== '') {
                        searchInput.value = '';
                    }
                    searchInput.focus();

                    // 隐藏搜索结果下拉框
                    const searchResults = document.getElementById('searchResults');
                    if (searchResults) {
                        searchResults.style.display = 'none';
                    }
                }
            }
            // 检查是否按下ESC键退出添加标记点状态
            else if (e.key === 'Escape' && this.currentMode === 'addMarker') {
                e.preventDefault();
                this.setMode('view'); // 退出添加标记点状态，返回查看模式
                console.log('ESC键 pressed - 退出添加标记点状态');
            }
        });

        // 绑定帮助按钮事件
        const helpBtn = document.getElementById('helpBtn');
        if (helpBtn) {
            helpBtn.addEventListener('click', () => {
                this.showHelpModal();
            });
        }

        // 绑定帮助模态框关闭事件
        const closeHelp = document.getElementById('closeHelp');
        if (closeHelp) {
            closeHelp.addEventListener('click', () => {
                this.closeHelpModal();
            });
        }

        // 帮助面板：新手引导按钮
        const startHelpTourFromHelpModalBtn = document.getElementById('startHelpTourFromHelpModalBtn');
        if (startHelpTourFromHelpModalBtn) {
            startHelpTourFromHelpModalBtn.addEventListener('click', () => {
                // 先关帮助面板，避免遮挡
                this.closeHelpModal();
                // 延迟一下，确保模态关闭后再启动引导
                setTimeout(() => {
                    if (typeof window.startRoadbookHelpTour === 'function') {
                        window.startRoadbookHelpTour();
                    } else {
                        console.warn('startRoadbookHelpTour 未就绪，请确认 help_tour.js 已加载');
                    }
                }, 120);
            });
        }

        // 日期详情面板事件
        const closeDateDetailBtn = document.getElementById('closeDateDetailBtn');
        if (closeDateDetailBtn) {
            closeDateDetailBtn.addEventListener('click', () => {
                this.closeDateDetail();
            });
        }

        // saveDateNotesBtn listener removed for real-time save

        // 日期备注便签关闭按钮事件
        const closeDateNotesSticky = document.getElementById('closeDateNotesSticky');
        if (closeDateNotesSticky) {
            closeDateNotesSticky.addEventListener('click', () => {
                this.hideDateNotesSticky();
            });
        }

        // 为dateNotesInput添加粘贴事件监听器
        const dateNotesInput = document.getElementById('dateNotesInput');
        if (dateNotesInput) {
            dateNotesInput.addEventListener('paste', (e) => this.handleDateNotesPaste(e));
        }


        // (The 'applyDateRangeFilterBtn' listener has been removed as it is now redundant)

        // 点击页面其他地方隐藏日期选择器
        document.addEventListener('click', (e) => {
            const picker = document.getElementById('dateRangePicker');
            const fitBtn = document.getElementById('fitViewBtn');
            if (picker && picker.style.display === 'flex' && !picker.contains(e.target) && !fitBtn.contains(e.target)) {
                picker.style.display = 'none';
            }
        });

        // 点击模态框外部关闭
        window.addEventListener('click', (e) => {
            const helpModal = document.getElementById('helpModal');
            if (e.target === helpModal) {
                this.closeHelpModal();
            }
        });

        // 主题切换按钮事件
        const themeToggleBtn = document.getElementById('themeToggleBtn');
        if (themeToggleBtn) {
            themeToggleBtn.addEventListener('click', () => {
                this.toggleTheme();
            });
        }

        // 扩大按钮事件
        const expandMarkerLabelsBtn = document.getElementById('expandMarkerLabelsBtn');
        if (expandMarkerLabelsBtn) {
            expandMarkerLabelsBtn.addEventListener('click', () => {
                this.openExpandModal('marker', '标记点备注');
            });
        }

        const expandConnectionLabelsBtn = document.getElementById('expandConnectionLabelsBtn');
        if (expandConnectionLabelsBtn) {
            expandConnectionLabelsBtn.addEventListener('click', () => {
                this.openExpandModal('connection', '连接线备注');
            });
        }

        const expandDateNotesBtn = document.getElementById('expandDateNotesBtn');
        if (expandDateNotesBtn) {
            expandDateNotesBtn.addEventListener('click', () => {
                this.openExpandModal('date', '日期备注');
            });
        }

        // 绑定添加消费按钮事件
        const addExpenseBtn = document.getElementById('addExpenseBtn');
        if (addExpenseBtn) {
            addExpenseBtn.addEventListener('click', () => {
                this.addCurrentDateExpense();
            });
        }

        // 绑定消费输入框回车事件
        const expenseCostInput = document.getElementById('expenseCostInput');
        const expenseRemarkInput = document.getElementById('expenseRemarkInput');

        const handleExpenseEnter = (e) => {
            if (e.key === 'Enter') {
                this.addCurrentDateExpense();
            }
        };

        if (expenseCostInput) {
            expenseCostInput.addEventListener('keydown', handleExpenseEnter);
        }
        if (expenseRemarkInput) {
            expenseRemarkInput.addEventListener('keydown', handleExpenseEnter);
        }

    }

    // 移动端功能初始化
    initMobileFeatures() {
        // 检测是否为移动设备
        if (!this.isMobileDevice()) {
            return; // 非移动设备不执行移动端适配
        }

        // 修改标题为只读模式
        const titleElement = document.querySelector('header h1');
        if (titleElement) {
            titleElement.textContent = `${titleElement.textContent} (只读模式)`;
        }

        // 显示进入提示
        alert('当前为移动端只读模式，如需编辑请使用电脑访问。');

        // 初始化移动端菜单功能
        this.initMobileMenu();

        // 监听窗口大小变化，适配横竖屏切换
        window.addEventListener('resize', () => {
            this.handleResize();
        });
    }

    initDebugFeatures() {
        // 使用 DebugModule 初始化调试功能
        if (window.DebugModule) {
            this.debugModule = new window.DebugModule(this);
            this.debugModule.initDebugFeatures();
        }
    }

    showDebugInfo() {
        // 委托给 DebugModule 处理
        if (this.debugModule) {
            this.debugModule.showDebugInfo();
        }
    }

    // 初始化移动端菜单
    initMobileMenu() {
        const menuToggleBtn = document.getElementById('menuToggleBtn');
        const rightPanel = document.querySelector('.right-panel');
        const closeSidebarBtn = document.getElementById('closeSidebarBtn');

        if (!menuToggleBtn || !rightPanel) {
            console.warn('移动端菜单元素未找到');
            return;
        }

        // 菜单切换按钮事件
        menuToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            // 如果侧边栏是展开的，就关闭它
            if (rightPanel.classList.contains('active')) {
                rightPanel.classList.remove('active');
                menuToggleBtn.textContent = '☰';
                console.log('菜单关闭');
            } else {
                // 如果侧边栏是关闭的，就展开它
                rightPanel.classList.add('active');
                menuToggleBtn.textContent = '✕';
                console.log('菜单展开');
            }
        });

        // 关闭侧边栏按钮事件
        if (closeSidebarBtn) {
            closeSidebarBtn.addEventListener('click', () => {
                rightPanel.classList.remove('active');
                menuToggleBtn.textContent = '☰';
            });
        }

        // 移动端点击外部关闭侧边栏（简化版本）
        if (this.isMobileDevice()) {
            // 点击地图区域时关闭侧边栏（但点击标记点和连接线时除外）
            const mapContainer = document.getElementById('mapContainer');
            if (mapContainer) {
                mapContainer.addEventListener('click', (e) => {
                    // 如果点击的是地图空白区域（不是标记点、连接线等），且不是侧边栏和菜单按钮
                    if (rightPanel.classList.contains('active') &&
                        !rightPanel.contains(e.target) &&
                        !menuToggleBtn.contains(e.target) &&
                        !e.target.closest('.leaflet-marker-icon') && // 不是标记点
                        !e.target.closest('.leaflet-interactive')) { // 不是连接线等交互元素
                        rightPanel.classList.remove('active');
                        menuToggleBtn.textContent = '☰';
                    }
                });
            }
        }
    }

    // 处理窗口大小变化
    handleResize() {
        const menuToggleBtn = document.getElementById('menuToggleBtn');
        const rightPanel = document.querySelector('.right-panel');

        if (!menuToggleBtn || !rightPanel) {
            return;
        }

        if (window.innerWidth > 768) {
            // 大屏幕设备
            rightPanel.classList.remove('active');
            menuToggleBtn.textContent = '☰';
        }
    }

    // 配置后端API地址
    configureBackendApi() {
        // 使用全局 apiBaseUrl 变量，它是当前页面加载时计算出的实际生效地址
        const currentEffectiveUrl = apiBaseUrl;
        let defaultPromptValue = localStorage.getItem('custom_api_base_url') || '';

        // 构建提示信息
        let promptMsg = `请输入后端 API 地址 (例如 https://api.example.com)\n\n`;
        promptMsg += `当前实际生效地址: ${currentEffectiveUrl}\n`;

        promptMsg += `\n(留空并确认可清除自定义设置，恢复默认)`;

        const url = prompt(promptMsg, defaultPromptValue);

        if (url === null) {
            return; // 用户点击取消
        }

        if (url.trim() === '') {
            localStorage.removeItem('custom_api_base_url');
            alert('已清除自定义设置，即将刷新页面');
            window.location.reload();
        } else {
            localStorage.setItem('custom_api_base_url', url.replace(/\/$/, ''));
            alert('设置成功，即将刷新页面');
            window.location.reload();
        }
    }

}

// 初始化应用
let app;
document.addEventListener('DOMContentLoaded', () => {
    console.log('RoadbookMaker已加载，支持Ctrl+Z撤销功能');

    app = new RoadbookApp();
    window.app = app; // 使应用实例全局可访问

    // Initialize the HTML exporter module
    if (typeof RoadbookHtmlExporter !== 'undefined' && window.app) {
        window.htmlExporter = new RoadbookHtmlExporter(window.app);
        // HTML导出按钮事件现在在script.js中统一处理
    }

    // 绑定标题双击事件
    const mainTitle = document.getElementById('mainTitle');
    if (mainTitle) {
        mainTitle.addEventListener('dblclick', () => {
            app.configureBackendApi();
        });
    }
});
