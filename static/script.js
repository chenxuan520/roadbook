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
        this.dateNotes = {}; // 日期备注信息

        this.init();
    }

    // 添加方法到类中
    addHistory(operation, data) {
        // 记录操作到历史栈
        this.history.push({
            operation: operation,
            data: data,
            timestamp: Date.now()
        });

        // 限制历史记录数量
        if (this.history.length > this.historyLimit) {
            this.history.shift(); // 移除最旧的记录
        }
    }

    // 检测是否为移动设备
    isMobileDevice() {
        // 检测多种移动设备特征
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (navigator.maxTouchPoints && navigator.maxTouchPoints > 2) || // 检测触摸屏
               (window.innerWidth <= 768); // 小屏幕设备也视为移动设备
    }

    // 撤销操作
    undo() {
        if (this.history.length === 0) {
            console.log('没有可撤销的操作');
            return false;
        }

        const lastOperation = this.history.pop();

        switch (lastOperation.operation) {
            case 'addMarker':
                return this.undoAddMarker(lastOperation.data);
            case 'removeMarker':
                return this.undoRemoveMarker(lastOperation.data);
            case 'addConnection':
                return this.undoAddConnection(lastOperation.data);
            case 'removeConnection':
                return this.undoRemoveConnection(lastOperation.data);
            case 'moveMarker':
                return this.undoMoveMarker(lastOperation.data);
            default:
                console.error('未知的操作类型:', lastOperation.operation);
                return false;
        }
    }

    undoAddMarker(data) {
        // 查找要撤销的标记点
        const markerIndex = this.markers.findIndex(m => m.id === data.id);
        if (markerIndex !== -1) {
            const marker = this.markers[markerIndex];
            this.removeMarker(marker);
            console.log(`已撤销添加标记点: ${data.title}`);
            return true;
        }
        console.warn('找不到要撤销的标记点:', data);
        return false;
    }

    undoRemoveMarker(data) {
        // 重新添加标记点
        const icon = this.createMarkerIcon(data.icon, this.markers.length + 1);

        const marker = L.marker([data.position[0], data.position[1]], {
            icon: icon,
            draggable: true,
            title: data.title
        }).addTo(this.map);

        const markerData = {
            id: data.id,
            marker: marker,
            position: data.position,
            title: data.title,
            labels: data.labels || [],
            icon: data.icon,
            createdAt: data.createdAt,
            dateTimes: data.dateTimes || [data.dateTime],
            dateTime: data.dateTimes ? data.dateTimes[0] : data.dateTime
        };

        this.markers.push(markerData);

        // 添加事件监听
        marker.on('click', () => {
            this.showMarkerDetail(markerData);
        });

        marker.on('contextmenu', (e) => {
            e.preventDefault();
            this.showMarkerContextMenu(markerData);
        });

        marker.on('mouseover', (e) => {
            this.showMarkerTooltip(markerData, e.latlng);
        });

        marker.on('mouseout', () => {
            this.hideMarkerTooltip();
        });

        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            markerData.position = [newPos.lat, newPos.lng];

            // 更新连接线
            this.updateConnections();
            // 更新标注位置
            this.updateLabels();

            // 如果当前标记点正在详情面板中显示，更新坐标显示
            if (this.currentMarker === markerData) {
                const markerCoords = document.getElementById('markerCoords');
                if (markerCoords) {
                    markerCoords.textContent = `${newPos.lng.toFixed(6)}, ${newPos.lat.toFixed(6)}`;
                }
            }

            // 更新标记点列表中的坐标显示
            this.updateMarkerList();

            // 保存到本地存储
            this.saveToLocalStorage();
        });

        console.log(`已撤销删除标记点: ${data.title}`);
        return true;
    }

    undoAddConnection(data) {
        // 查找要撤销的连接线
        const connectionIndex = this.connections.findIndex(c => c.id === data.id);
        if (connectionIndex !== -1) {
            const connection = this.connections[connectionIndex];
            this.removeConnection(connection);
            console.log('已撤销添加连接线');
            return true;
        }
        console.warn('找不到要撤销的连接线:', data);
        return false;
    }

    undoRemoveConnection(data) {
        // 通过ID查找起始点和终点
        const startMarker = this.markers.find(m => m.id === data.startId);
        const endMarker = this.markers.find(m => m.id === data.endId);

        if (!startMarker || !endMarker) {
            console.error('连接线的起始点或终点不存在:', data.startId, data.endId);
            return false;
        }

        // 创建连接线
        const polyline = L.polyline([
            [startMarker.position[0], startMarker.position[1]],
            [endMarker.position[0], endMarker.position[1]]
        ], {
            color: this.getTransportColor(data.transportType),
            weight: 6,
            opacity: 1.0,
            smoothFactor: 1.0
        }).addTo(this.map);

        // 添加终点标记（小圆点）
        const endCircle = L.circleMarker([endMarker.position[0], endMarker.position[1]], {
            radius: 6,
            fillColor: this.getTransportColor(data.transportType),
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(this.map);

        // 创建箭头
        const arrowHead = this.createArrowHead(startMarker.position, endMarker.position, data.transportType);
        arrowHead.addTo(this.map);

        // 计算中点位置并添加交通图标
        const startLat = parseFloat(startMarker.position[0]);
        const startLng = parseFloat(startMarker.position[1]);
        const endLat = parseFloat(endMarker.position[0]);
        const endLng = parseFloat(endMarker.position[1]);

        if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
            console.error('连接线坐标无效:', startMarker.position, endMarker.position);
            return false;
        }

        const midLat = (startLat + endLat) / 2;
        const midLng = (startLng + endLng) / 2;
        const transportIcon = this.getTransportIcon(data.transportType);

        const iconMarker = L.marker([midLat, midLng], {
            icon: L.divIcon({
                className: 'transport-icon',
                html: `<div style="background-color: white; border: 2px solid ${this.getTransportColor(data.transportType)}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${transportIcon}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        }).addTo(this.map);

        const connection = {
            id: data.id,
            startId: data.startId,
            endId: data.endId,
            transportType: data.transportType,
            polyline: polyline,
            endCircle: endCircle,
            iconMarker: iconMarker,
            arrowHead: arrowHead,
            dateTime: data.dateTime || this.getCurrentLocalDateTime(),
            label: data.label || '',
            duration: data.duration || 0,
            startTitle: data.startTitle || startMarker.title,
            endTitle: data.endTitle || endMarker.title
        };

        // 添加连接线事件
        const self = this;
        polyline.on('click', function() {
            self.showConnectionDetail(connection);
        });

        polyline.on('mouseover', function(e) {
            self.showConnectionTooltip(connection, e.latlng);
        });

        polyline.on('mouseout', function() {
            self.hideConnectionTooltip();
        });

        this.connections.push(connection);

        console.log('已撤销删除连接线');
        return true;
    }

    undoMoveMarker(data) {
        // 查找标记点并恢复到之前的位置
        const marker = this.markers.find(m => m.id === data.id);
        if (marker) {
            // 将标记点移回之前的位置
            marker.marker.setLatLng([data.prevPosition[0], data.prevPosition[1]]);
            marker.position = [...data.prevPosition];

            // 更新连接线和标注位置
            this.updateConnections();
            this.updateLabels();

            // 更新标记点列表
            this.updateMarkerList();

            console.log(`已撤销移动标记点 "${marker.title}" 到 ${data.prevPosition[1].toFixed(6)}, ${data.prevPosition[0].toFixed(6)}`);
            return true;
        }
        console.warn('找不到要撤销移动的标记点:', data);
        return false;
    }

    init() {
        // 检测是否为移动设备
        if (this.isMobileDevice()) {
            alert('提示：当前界面不支持手机端编辑功能，请使用电脑访问以获得完整体验。导出的路书可在手机端正常查看。');
            // 可以考虑在移动设备上显示一个更友好的提示页面，而不是完全阻止使用
        }

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

        // 现在初始化地图时会使用正确的设置
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

                const { latitude, longitude } = position.coords;
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

    // 从缓存中只加载设置而不加载其他数据
    loadSettingsFromCache() {
        try {
            const savedData = localStorage.getItem('roadbookData');
            if (savedData) {
                const data = JSON.parse(savedData);
                // 只返回设置相关的信息
                return {
                    currentLayer: data.currentLayer,
                    currentSearchMethod: data.currentSearchMethod
                };
            }
        } catch (error) {
            console.error('从本地存储加载设置失败:', error);
        }
        return null;
    }

    initMap() {
        // 初始化地图，使用OpenStreetMap作为默认图层
        this.map = L.map('mapContainer', {
            zoomSnap: 1,  // 使缩放级别步长进行捕捉，实现更平滑的缩放
            zoomDelta: 1  // 设置缩放增量
        }).setView([39.90923, 116.397428], 10); // 北京天安门

        // 定义地图搜索能力配置
        this.mapSearchConfig = {
            osm: {
                searchable: true,
                name: 'OpenStreetMap',
                searchUrl: 'https://nominatim.openstreetmap.org/search',
                params: {
                    format: 'json',
                    limit: 10
                },
                parser: 'nominatim' // 使用Nominatim API
            },
            satellite: {
                searchable: false, // 卫星图禁用搜索
                name: 'ESRI卫星图'
            },
            gaode: {
                searchable: true,
                name: '高德地图',
                searchUrl: 'https://map.chenxuanweb.top/api/cnmap/search', // 使用TianSearch端点
                params: {
                    format: 'json',
                    limit: 10
                },
                parser: 'nominatim' // 使用Nominatim格式，因为TianSearch与Nominatim格式一致
            },
            gaode_satellite: {
                searchable: false, // 高德卫星图禁用搜索
                name: '高德卫星图'
            },
            google: {
                searchable: true,
                name: 'Google地图',
                searchUrl: 'https://photon.komoot.io/api/',
                params: {
                    limit: 10
                },
                parser: 'photon' // 使用Photon API
            },
            google_satellite: {
                searchable: false, // Google卫星图禁用搜索
                name: 'Google卫星图'
            }
        };

        // 定义地图图层
        this.mapLayers = {
            osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }),
            satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Tiles © Esri',
                maxZoom: 19
            }),
            // 高德地图矢量地图 - 无需key，直接访问瓦片
            gaode: L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', {
                attribution: '© 高德地图',
                maxZoom: 19,
                subdomains: ['1', '2', '3', '4']
            }),
            // 高德地图卫星图 - 无需key，直接访问瓦片
            gaode_satellite: L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', {
                attribution: '© 高德地图',
                maxZoom: 19,
                subdomains: ['1', '2', '3', '4']
            }),
            // Google地图 - 无需key，直接访问瓦片
            google: L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
                attribution: '© Google Maps',
                maxZoom: 19,
                subdomains: ['0', '1', '2', '3']
            }),
            // Google地图卫星图 - 无需key，直接访问瓦片
            google_satellite: L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
                attribution: '© Google Maps',
                maxZoom: 19,
                subdomains: ['0', '1', '2', '3']
            })
        };

        // 添加当前图层到地图
        // this.currentLayer 已经在 init() 方法中设置好了
        this.mapLayers[this.currentLayer].addTo(this.map);

        // 添加比例尺控件
        L.control.scale({imperial: false, metric: true}).addTo(this.map);

        // 添加地图点击事件
        this.map.on('click', (e) => {
            if (this.currentMode === 'addMarker') {
                this.addMarker(e.latlng);
            }
        });

        // 添加地图右键点击事件，用于取消添加标记点状态
        this.map.on('contextmenu', () => {
            if (this.currentMode === 'addMarker') {
                this.setMode('view'); // 取消添加标记点状态
            }
        });

        // 在地图容器DOM元素上添加右键事件监听器以阻止默认菜单
        const mapContainer = this.map.getContainer();
        mapContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault(); // 阻止浏览器默认右键菜单
        });

    }

    bindEvents() {
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

        // 连接线详情面板中的交通方式按钮事件
        document.querySelectorAll('.transport-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // 只有在连接线详情面板中才处理交通方式切换
                if (this.currentConnection) {
                    document.querySelectorAll('.transport-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    // 更新当前连接线的交通方式
                    const transportType = btn.dataset.transport;
                    this.updateConnectionTransport(this.currentConnection, transportType);
                }
            });
        });

        // 图标选项点击事件
        document.querySelectorAll('.icon-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            });
        });

        // 交通方式按钮点击事件
        document.querySelectorAll('.transport-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.transport-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // 更新隐藏的select值
                const transportType = btn.dataset.transport;
                document.getElementById('transportType').value = transportType;
            });
        });

        // 模态框事件
        const closeBtn = document.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.closeModals();
            });
        }

        const confirmConnect = document.getElementById('confirmConnect');
        if (confirmConnect) {
            confirmConnect.addEventListener('click', () => {
                this.connectMarkers();
            });
        }


        // 图标选项点击事件
        document.querySelectorAll('.icon-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            });
        });

        // 交通方式按钮点击事件
        document.querySelectorAll('.transport-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.transport-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // 更新隐藏的select值
                const transportType = btn.dataset.transport;
                document.getElementById('transportType').value = transportType;
            });
        });

        // 详情面板事件
        const closeDetailBtn = document.getElementById('closeDetailBtn');
        if (closeDetailBtn) {
            closeDetailBtn.addEventListener('click', () => {
                this.hideMarkerDetail();
            });
        }

        const saveMarkerBtn = document.getElementById('saveMarkerBtn');
        if (saveMarkerBtn) {
            saveMarkerBtn.addEventListener('click', () => {
                this.saveMarkerDetail();
            });
        }

        // 保存连接线按钮事件
        const saveConnectionBtn = document.getElementById('saveConnectionBtn');
        if (saveConnectionBtn) {
            saveConnectionBtn.addEventListener('click', () => {
                this.saveConnectionDetail();
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
                this.handleFitViewClick();
            });
        }

        // 添加键盘事件监听器
        document.addEventListener('keydown', (e) => {
            // 检查是否按下Ctrl+Z（或Cmd+Z）且没有在输入框中输入
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' &&
                !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault(); // 阻止浏览器默认的撤销操作
                this.undo(); // 执行撤销
            }
            // 检查是否按下A键添加标记点
            else if (e.key.toLowerCase() === 'a' &&
                     !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.setMode('addMarker'); // 进入添加标记点模式
            }
            // 检查是否按下C键连接标记点
            else if (e.key.toLowerCase() === 'c' &&
                     !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.showConnectModal(); // 打开连接标记点界面
            }
            // 检查是否按下H键或?键显示帮助
            else if ((e.key.toLowerCase() === 'h' || e.key === '?') &&
                     !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.showHelpModal(); // 显示帮助弹窗
            }
            // 检查是否按下D键删除选中的标记点或连接线
            else if (e.key.toLowerCase() === 'd' &&
                     !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.deleteCurrentElement(); // 删除当前选中的元素
            }
            // 检查是否按下F键自动调整视窗
            else if (e.key.toLowerCase() === 'f' &&
                     !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.handleFitViewClick(); // 执行视窗调整（与右上角按钮相同的功能）
            }
            // 检查是否按下/键聚焦到搜索框
            else if (e.key === '/' &&
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

        // 日期详情面板事件
        const closeDateDetailBtn = document.getElementById('closeDateDetailBtn');
        if (closeDateDetailBtn) {
            closeDateDetailBtn.addEventListener('click', () => {
                this.closeDateDetail();
            });
        }

        const saveDateNotesBtn = document.getElementById('saveDateNotesBtn');
        if (saveDateNotesBtn) {
            saveDateNotesBtn.addEventListener('click', () => {
                this.saveDateNotes();
            });
        }

        // 日期备注便签关闭按钮事件
        const closeDateNotesSticky = document.getElementById('closeDateNotesSticky');
        if (closeDateNotesSticky) {
            closeDateNotesSticky.addEventListener('click', () => {
                this.hideDateNotesSticky();
            });
        }

        // 点击模态框外部关闭
        window.addEventListener('click', (e) => {
            const helpModal = document.getElementById('helpModal');
            if (e.target === helpModal) {
                this.closeHelpModal();
            }
        });
    }

    switchMapSource(newSource) {
        if (!this.mapLayers[newSource]) {
            console.error('不支持的地图源:', newSource);
            return;
        }

        // 移除当前图层
        this.map.removeLayer(this.mapLayers[this.currentLayer]);

        // 切换到新图层
        this.currentLayer = newSource;
        this.mapLayers[this.currentLayer].addTo(this.map);

        // 更新搜索框状态
        this.updateSearchInputState();

        console.log('地图源已切换到:', newSource);
    }

    updateSearchInputState() {
        const searchInput = document.getElementById('searchInput');
        const currentMapConfig = this.mapSearchConfig[this.currentLayer];

        if (searchInput && currentMapConfig) {
            if (currentMapConfig.searchable) {
                // 启用搜索框
                searchInput.disabled = false;
                searchInput.placeholder = '搜索地点...';
                searchInput.style.opacity = '1';
            } else {
                // 禁用搜索框
                searchInput.disabled = true;
                searchInput.placeholder = `当前地图(${currentMapConfig.name})不支持搜索`;
                searchInput.style.opacity = '0.6';

                // 隐藏搜索结果
                const searchResults = document.getElementById('searchResults');
                if (searchResults) {
                    searchResults.style.display = 'none';
                }
            }
        }
    }

    setMode(mode) {
        this.currentMode = mode;

        // 更新按钮状态
        document.querySelectorAll('.btn').forEach(btn => {
            btn.classList.remove('active');
        });

        if (mode === 'addMarker') {
            document.getElementById('addMarkerBtn').classList.add('active');
            this.map.getContainer().style.cursor = 'crosshair';
        } else {
            this.map.getContainer().style.cursor = 'pointer';
        }
    }

    addMarker(latlng) {
        const markerId = Date.now();

        // 默认使用数字图标，用户可以在详情面板中修改
        const defaultIcon = {
            type: 'number',
            icon: String(this.markers.length + 1), // 使用数字作为默认图标
            color: '#667eea'
        };

        const icon = this.createMarkerIcon(defaultIcon, this.markers.length + 1);

        const marker = L.marker([latlng.lat, latlng.lng], {
            icon: icon,
            draggable: true,
            title: `标记点${this.markers.length + 1}`
        }).addTo(this.map);

        // 确定新标记点的时间 - 如果有上一个点则使用其时间，否则为当天00:00
        let newMarkerDateTime = this.getCurrentLocalDateTime();
        if (this.markers.length > 0) {
            // 使用最后一个标记点的时间
            const lastMarker = this.markers[this.markers.length - 1];
            if (lastMarker.dateTimes && lastMarker.dateTimes.length > 0) {
                newMarkerDateTime = lastMarker.dateTimes[0]; // 使用上一个点的第一个时间
            } else if (lastMarker.dateTime) {
                newMarkerDateTime = lastMarker.dateTime;
            } else {
                // 如果上一个点也没有时间，则使用当天00:00
                const lastDateTime = new Date();
                newMarkerDateTime = `${lastDateTime.getFullYear()}-${String(lastDateTime.getMonth() + 1).padStart(2, '0')}-${String(lastDateTime.getDate()).padStart(2, '0')} 00:00:00`;
            }
        } else {
            // 如果没有上一个点，使用当天00:00
            const today = new Date();
            newMarkerDateTime = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')} 00:00:00`;
        }

        const markerData = {
            id: markerId, // 不可见不可编辑的唯一ID
            marker: marker,
            position: [latlng.lat, latlng.lng],
            title: `标记点${this.markers.length + 1}`,
            labels: [], // 存储标注文本，不直接显示
            icon: defaultIcon, // 保存图标信息
            createdAt: this.getCurrentLocalDateTime(),
            dateTimes: [newMarkerDateTime], // 改为数组，支持多个时间点
            dateTime: newMarkerDateTime // 使用第一个时间点作为默认时间
        };

        this.markers.push(markerData);
        this.updateMarkerList();
        this.setMode('view');

        // 添加点击事件显示详情
        marker.on('click', () => {
            this.showMarkerDetail(markerData);
        });

        // 添加右键菜单事件
        marker.on('contextmenu', (e) => {
            e.preventDefault(); // 防止默认右键菜单
            this.showMarkerContextMenu(markerData);
        });

        // 添加悬浮事件显示标注信息
        marker.on('mouseover', (e) => {
            this.showMarkerTooltip(markerData, e.latlng);
        });

        marker.on('mouseout', () => {
            this.hideMarkerTooltip();
        });

        // 添加拖拽事件更新位置
        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            const oldPosition = [...markerData.position]; // 保存之前的位置

            markerData.position = [newPos.lat, newPos.lng]; // position[0] = lat, position[1] = lng

            console.log(`拖拽事件触发 - 标记点ID: ${markerData.id}, 新坐标: [${newPos.lat}, ${newPos.lng}]`);

            // 记录移动操作到历史栈
            this.addHistory('moveMarker', {
                id: markerData.id,
                prevPosition: oldPosition,
                newPosition: [newPos.lat, newPos.lng]
            });

            // 更新连接线
            this.updateConnections();

            // 更新标注位置
            this.updateLabels();

            // 如果当前标记点正在详情面板中显示，更新坐标显示
            if (this.currentMarker === markerData) {
                const markerCoords = document.getElementById('markerCoords');
                if (markerCoords) {
                    // 正确的坐标显示格式：经度, 纬度
                    markerCoords.textContent =
                        `${newPos.lng.toFixed(6)}, ${newPos.lat.toFixed(6)}`;
                }
            }

            // 更新标记点列表中的坐标显示
            this.updateMarkerList();

            console.log(`标记点"${markerData.title}"坐标已更新: ${newPos.lat.toFixed(6)}, ${newPos.lng.toFixed(6)}`);

            // 保存到本地存储
            this.saveToLocalStorage();
            console.log(`拖拽后本地存储已保存`);
        });

        // 记录添加操作到历史栈
        this.addHistory('addMarker', {
            id: markerId,
            position: [latlng.lat, latlng.lng],
            title: `标记点${this.markers.length}`,
            icon: defaultIcon,
            createdAt: this.getCurrentLocalDateTime(),
            dateTimes: [this.getCurrentLocalDateTime()],
            dateTime: this.getCurrentLocalDateTime()
        });

        // 保存到本地存储
        this.saveToLocalStorage();
    }

    showIconModal() {
        document.getElementById('iconModal').style.display = 'block';
        // 重置选择状态
        document.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
        document.getElementById('customIcon').value = '';
        document.getElementById('iconColor').value = '#667eea';
    }

    updateCurrentIconPreview(iconConfig) {
        const preview = document.getElementById('currentIconPreview');
        if (preview && iconConfig) {
            preview.textContent = iconConfig.icon || '📍';
            preview.style.backgroundColor = iconConfig.color || '#667eea';
        }
    }

    confirmIconSelection() {
        const selectedOption = document.querySelector('.icon-option.selected');
        const customIcon = document.getElementById('customIcon').value.trim();
        const iconColor = document.getElementById('iconColor').value;

        let newIconConfig;

        if (customIcon) {
            // 使用自定义图标
            newIconConfig = {
                type: 'custom',
                icon: customIcon,
                color: iconColor
            };
        } else if (selectedOption) {
            // 使用预设图标
            const iconType = selectedOption.dataset.icon;
            const iconPreview = selectedOption.querySelector('.icon-preview');
            const icon = iconPreview.textContent;
            const color = iconPreview.style.backgroundColor;

            newIconConfig = {
                type: iconType,
                icon: icon,
                color: color
            };
        } else {
            // 如果没有选择，保持当前图标
            this.closeModals();
            return;
        }

        // 如果有当前标记点，更新其图标
        if (this.currentMarker) {
            this.currentMarker.icon = newIconConfig;

            // 重新创建标记点图标
            const newIcon = this.createMarkerIcon(newIconConfig, this.markers.indexOf(this.currentMarker) + 1);
            this.currentMarker.marker.setIcon(newIcon);

            // 更新预览
            this.updateCurrentIconPreview(newIconConfig);

            console.log(`标记点"${this.currentMarker.title}"图标已更新:`, newIconConfig);
        } else {
            // 如果没有当前标记点，设置为默认图标（用于新标记点）
            this.currentIcon = newIconConfig;
            console.log('默认图标已设置:', newIconConfig);
        }

        this.closeModals();
    }

    showConnectModal() {
        if (this.markers.length < 2) {
            alert('需要至少2个标记点才能连接！');
            return;
        }

        const startSelect = document.getElementById('startMarker');
        const endSelect = document.getElementById('endMarker');

        startSelect.innerHTML = '';
        endSelect.innerHTML = '';

        this.markers.forEach((marker, index) => {
            const option1 = new Option(marker.title, index);
            const option2 = new Option(marker.title, index);
            startSelect.add(option1);
            endSelect.add(option2);
        });

        // 默认选中最近创建的两个标记点
        if (this.markers.length >= 2) {
            // 按照创建时间排序，最新的两个点
            const sortedIndices = Array.from({length: this.markers.length}, (_, i) => i)
                .sort((a, b) => {
                    // 使用id作为时间戳的近似值，id越大表示越新创建
                    return this.markers[b].id - this.markers[a].id;
                });

            // 设置最近创建的两个点
            const newestIndex = sortedIndices[0];
            const secondNewestIndex = sortedIndices[1];

            startSelect.selectedIndex = secondNewestIndex; // 倒数第二个创建的作为起点
            endSelect.selectedIndex = newestIndex; // 最新创建的作为终点

            console.log(`默认选中最近创建的两个点: 起点[${secondNewestIndex}]${this.markers[secondNewestIndex].title} -> 终点[${newestIndex}]${this.markers[newestIndex].title}`);
        }

        document.getElementById('connectModal').style.display = 'block';
    }

    connectMarkers() {
        const startSelect = document.getElementById('startMarker');
        const endSelect = document.getElementById('endMarker');
        const transportSelect = document.getElementById('transportType');

        if (!startSelect || !endSelect || !transportSelect) {
            console.error('连接模态框元素不存在');
            return;
        }

        const startIndex = startSelect.selectedIndex;
        const endIndex = endSelect.selectedIndex;
        const transportType = transportSelect.value || 'car'; // 默认汽车

        if (startIndex === -1 || endIndex === -1) {
            alert('请选择有效的标记点！');
            return;
        }

        if (startIndex === endIndex) {
            alert('起始点和目标点不能相同！');
            return;
        }

        const startMarker = this.markers[startIndex];
        const endMarker = this.markers[endIndex];

        if (!startMarker || !endMarker) {
            console.error('标记点不存在:', startIndex, endIndex);
            alert('标记点数据错误！');
            return;
        }

        console.log('创建连接线:', startMarker.position, '->', endMarker.position);

        // 创建连接线 - 使用更明显的样式
        const polyline = L.polyline([
            [startMarker.position[0], startMarker.position[1]],
            [endMarker.position[0], endMarker.position[1]]
        ], {
            color: this.getTransportColor(transportType),
            weight: 6,  // 稍微减小线宽
            opacity: 1.0,  // 完全不透明
            smoothFactor: 1.0
        }).addTo(this.map);

        // 创建箭头 - 使用三角形标记
        const arrowHead = this.createArrowHead(startMarker.position, endMarker.position, transportType);
        arrowHead.addTo(this.map);

        // 添加终点标记（小圆点）
        const endCircle = L.circleMarker([endMarker.position[0], endMarker.position[1]], {
            radius: 6,
            fillColor: this.getTransportColor(transportType),
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(this.map);

        // 计算中点位置 - 添加错误检查
        if (!startMarker.position || !endMarker.position) {
            console.error('标记点位置数据不完整:', startMarker, endMarker);
            alert('标记点位置数据错误，请重新选择！');
            return;
        }

        const startLat = parseFloat(startMarker.position[0]);
        const startLng = parseFloat(startMarker.position[1]);
        const endLat = parseFloat(endMarker.position[0]);
        const endLng = parseFloat(endMarker.position[1]);

        if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
            console.error('坐标数据无效:', startMarker.position, endMarker.position);
            alert('坐标数据错误，请重新选择标记点！');
            return;
        }

        const midLat = (startLat + endLat) / 2;
        const midLng = (startLng + endLng) / 2;

        // 创建交通方式图标
        const transportIcon = this.getTransportIcon(transportType);
        const iconMarker = L.marker([midLat, midLng], {
            icon: L.divIcon({
                className: 'transport-icon',
                html: `<div style="background-color: white; border: 2px solid ${this.getTransportColor(transportType)}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${transportIcon}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        }).addTo(this.map);

        // 使用起始点的时间作为连接线的默认时间
        let connectionDateTime = this.getCurrentLocalDateTime();
        if (startMarker.dateTimes && startMarker.dateTimes.length > 0) {
            connectionDateTime = startMarker.dateTimes[0]; // 使用起始点的第一个时间
        } else if (startMarker.dateTime) {
            connectionDateTime = startMarker.dateTime;
        } else {
            // 如果起始点也没有时间，则使用当前时间
            connectionDateTime = this.getCurrentLocalDateTime();
        }

        const connection = {
            id: Date.now(),
            startId: startMarker.id, // 使用ID引用开始标记点
            endId: endMarker.id,     // 使用ID引用结束标记点
            transportType: transportType,
            polyline: polyline,
            endCircle: endCircle,
            iconMarker: iconMarker,
            arrowHead: arrowHead, // 添加箭头
            dateTime: connectionDateTime,
            label: '',
            duration: 0, // 新增：连接耗时（分钟）
            startTitle: startMarker.title, // 保存创建时的标题，用于显示
            endTitle: endMarker.title      // 保存创建时的标题，用于显示
        };

        // 添加连接线事件 - 使用箭头函数确保this上下文正确
        const self = this;
        polyline.on('click', function() {
            self.showConnectionDetail(connection);
        });

        polyline.on('mouseover', function(e) {
            self.showConnectionTooltip(connection, e.latlng);
        });

        polyline.on('mouseout', function() {
            self.hideConnectionTooltip();
        });

        this.connections.push(connection);

        // 记录添加连接操作到历史栈
        this.addHistory('addConnection', {
            id: connection.id,
            startId: connection.startId,
            endId: connection.endId,
            transportType: connection.transportType,
            dateTime: connection.dateTime,
            label: connection.label,
            duration: connection.duration,
            startTitle: connection.startTitle,
            endTitle: connection.endTitle
        });

        this.closeModals();

        // 保存到本地存储
        this.saveToLocalStorage();

        console.log('连接线创建成功，连接数:', this.connections.length);
    }

    getTransportColor(type) {
        const colors = {
            car: '#FF5722',
            train: '#2196F3',
            subway: '#9C27B0',  // 地铁 - 紫色
            plane: '#4CAF50',
            walk: '#FF9800'
        };
        return colors[type] || '#666';
    }

    createMarkerIcon(iconConfig, _number) {
        const icon = iconConfig.icon || '📍';
        const color = iconConfig.color || '#667eea';

        // 用户选择什么就显示什么，不自动添加数字
        const displayContent = icon;

        return L.divIcon({
            className: 'custom-marker',
            html: `<div style="background-color: ${color}; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;">${displayContent}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
    }

    getCurrentLocalDateTime() {
        // 获取本地时间，格式化为中文显示
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    getLocalDateTimeForInput(dateTimeString) {
        // 将日期时间字符串转换为datetime-local输入框需要的格式
        if (!dateTimeString) return '';

        try {
            const date = new Date(dateTimeString);
            if (isNaN(date.getTime())) return '';

            // 获取本地时间的各个部分
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');

            return `${year}-${month}-${day}T${hours}:${minutes}`;
        } catch (error) {
            console.error('日期时间转换错误:', error);
            return '';
        }
    }

    createArrowHead(startPos, endPos, transportType) {
        // 计算箭头位置（在线段中间偏后位置，避免与标记点冲突）
        const startLat = parseFloat(startPos[0]);
        const startLng = parseFloat(startPos[1]);
        const endLat = parseFloat(endPos[0]);
        const endLng = parseFloat(endPos[1]);

        // 计算方向角度 - 使用正确的数学方法
        // 在地理坐标系中，我们需要计算从起点到终点的方向
        const deltaLat = endLat - startLat; // 纬度差（垂直方向，北为正）
        const deltaLng = endLng - startLng; // 经度差（水平方向，东为正）

        // 计算基础角度（弧度）
        let angle = Math.atan2(deltaLng, deltaLat); // 注意参数顺序：atan2(y, x)

        // 转换为角度并调整方向
        // 由于箭头图标默认指向上方（北），我们需要旋转到正确的方向
        angle = angle * 180 / Math.PI;

        // 计算线段长度的75%位置（避免太靠近终点）
        const ratio = 0.75;
        const arrowLat = startLat + (endLat - startLat) * ratio;
        const arrowLng = startLng + (endLng - startLng) * ratio;

        // 创建大号箭头图标 - 增大尺寸提高可见性
        const arrowColor = this.getTransportColor(transportType);
        const arrowIcon = L.divIcon({
            className: 'arrow-icon',
            html: `<div style="
                position: relative;
                width: 28px;
                height: 28px;
                transform: rotate(${angle}deg);
                transform-origin: center;">
                <div style="
                    position: absolute;
                    top: 0;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 0;
                    height: 0;
                    border-left: 10px solid transparent;
                    border-right: 10px solid transparent;
                    border-bottom: 20px solid ${arrowColor};
                    filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4));
                "></div>
            </div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });

        return L.marker([arrowLat, arrowLng], {
            icon: arrowIcon,
            interactive: false, // 箭头不参与交互
            zIndexOffset: 15 // 确保箭头在连接线之上但低于标记点
        });
    }

    // 计算两点之间的直线距离（米）
    calculateLineDistance(latlng1, latlng2) {
        const R = 6371e3; // 地球半径（米）
        const φ1 = latlng1[0] * Math.PI/180;
        const φ2 = latlng2[0] * Math.PI/180;
        const Δφ = (latlng2[0]-latlng1[0]) * Math.PI/180;
        const Δλ = (latlng2[1]-latlng1[1]) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c; // 距离以米为单位
    }

    getTransportTypeName(type) {
        const names = {
            car: '汽车',
            train: '火车',
            subway: '地铁',
            plane: '飞机',
            walk: '步行'
        };
        return names[type] || '其他';
    }

    showMarkerTooltip(markerData, latlng) {
        let tooltipContent = `<div style="background: rgba(0,0,0,0.8); color: white; padding: 8px; border-radius: 4px; font-size: 12px;">`;
        tooltipContent += `<div><strong>${markerData.title}</strong></div>`;
        tooltipContent += `<div>坐标: ${markerData.position[1].toFixed(6)}, ${markerData.position[0].toFixed(6)}</div>`;

        // 显示多个时间点，按日期分组（从早到晚排序）
        if (markerData.dateTimes && markerData.dateTimes.length > 0) {
            // 按日期分组时间点
            const timesByDate = {};
            markerData.dateTimes.forEach(dt => {
                const dateKey = this.getDateKey(dt);
                if (!timesByDate[dateKey]) {
                    timesByDate[dateKey] = [];
                }
                timesByDate[dateKey].push(dt); // 保存完整时间用于排序
            });

            // 获取排序后的日期（从早到晚）
            const sortedDates = Object.keys(timesByDate).sort((a, b) => new Date(a) - new Date(b));

            if (sortedDates.length === 1) {
                // 只有一个日期，直接显示时间（按时间排序）
                const times = timesByDate[sortedDates[0]]
                    .sort((a, b) => new Date(a) - new Date(b))
                    .map(dt => this.formatTime(dt))
                    .join(', ');
                tooltipContent += `<div>时间: ${times}</div>`;
            } else {
                // 多个日期，按日期分组显示（从早到晚）
                tooltipContent += `<div>时间:</div>`;
                sortedDates.forEach(date => {
                    const dateHeader = this.formatDateHeader(date);
                    const times = timesByDate[date]
                        .sort((a, b) => new Date(a) - new Date(b))
                        .map(dt => this.formatTime(dt))
                        .join(', ');
                    tooltipContent += `<div style="margin-left: 8px;">• ${dateHeader}: ${times}</div>`;
                });
            }
        } else if (markerData.dateTime) {
            tooltipContent += `<div>时间: ${this.formatTime(markerData.dateTime)}</div>`;
        }

        if (markerData.labels && markerData.labels.length > 0) {
            const labelsText = markerData.labels.join('; ');
            tooltipContent += `<div>标注: ${labelsText}</div>`;
        }
        tooltipContent += `</div>`;

        if (!this.markerTooltip) {
            this.markerTooltip = L.tooltip({
                permanent: false,
                direction: 'top',
                className: 'marker-tooltip'
            });
        }

        this.markerTooltip.setContent(tooltipContent);
        this.markerTooltip.setLatLng(latlng);
        this.markerTooltip.addTo(this.map);
    }

    hideMarkerTooltip() {
        if (this.markerTooltip) {
            this.markerTooltip.remove();
            this.markerTooltip = null;
        }
    }

    showConnectionTooltip(connection, latlng) {
        // 通过ID获取当前的起始点和终点对象，确保显示最新的标题
        const startMarker = this.markers.find(m => m.id === connection.startId);
        const endMarker = this.markers.find(m => m.id === connection.endId);

        const startTitle = startMarker ? startMarker.title : connection.startTitle;
        const endTitle = endMarker ? endMarker.title : connection.endTitle;

        let tooltipContent = `<div style="background: rgba(0,0,0,0.8); color: white; padding: 8px; border-radius: 4px; font-size: 12px;">`;
        tooltipContent += `<div><strong>${startTitle} → ${endTitle}</strong></div>`;
        tooltipContent += `<div>${this.getTransportIcon(connection.transportType)} ${this.getTransportTypeName(connection.transportType)}</div>`;

        // 动态计算并添加距离信息（复用已找到的startMarker和endMarker）
        if (startMarker && endMarker) {
            const distance = this.calculateLineDistance(startMarker.position, endMarker.position);
            let distanceStr;
            if (distance > 1000) {
                distanceStr = (distance / 1000).toFixed(2) + ' km';
            } else {
                distanceStr = Math.round(distance) + ' m';
            }
            tooltipContent += `<div>距离: ${distanceStr}</div>`;
        }

        if (connection.duration > 0) {
            tooltipContent += `<div>耗时: ${connection.duration} 小时</div>`;
        }
        if (connection.dateTime) {
            // 使用相同的格式化方式显示时间
            tooltipContent += `<div>时间: ${this.formatTime(connection.dateTime)}</div>`;
        }
        if (connection.label) {
            tooltipContent += `<div>标注: ${connection.label}</div>`;
        }
        tooltipContent += `</div>`;

        if (!this.tooltip) {
            this.tooltip = L.tooltip({
                permanent: false,
                direction: 'top',
                className: 'connection-tooltip'
            });
        }

        this.tooltip.setContent(tooltipContent);
        this.tooltip.setLatLng(latlng);
        this.tooltip.addTo(this.map);
    }


    hideConnectionTooltip() {
        if (this.tooltip) {
            this.tooltip.remove();
            this.tooltip = null;
        }
    }

    getTransportIcon(type) {
        const icons = {
            car: '🚗',
            train: '🚄',
            subway: '🚇',  // 地铁
            plane: '✈️',
            walk: '🚶'
        };
        return icons[type] || '•';
    }

    showConnectionDetail(connectionData) {
        // 如果当前处于筛选模式，则退出筛选模式但保持当前视图
        this.checkAndHandleFilterMode();

        this.currentConnection = connectionData;
        this.currentMarker = null;

        // 设置面板标题
        const detailTitle = document.getElementById('detailTitle');
        if (detailTitle) {
            detailTitle.textContent = '连接线详情';
        }

        // 连接线不需要名称输入
        const markerNameInput = document.getElementById('markerNameInput');
        if (markerNameInput) {
            markerNameInput.style.display = 'none';
        }

        // 设置日期时间
        if (connectionData.dateTime) {
            const dateString = this.getLocalDateTimeForInput(connectionData.dateTime);
            const connectionDateInput = document.getElementById('connectionDateInput');
            if (connectionDateInput) {
                connectionDateInput.value = dateString;
            }
        } else {
            const now = this.getLocalDateTimeForInput(this.getCurrentLocalDateTime());
            const connectionDateInput = document.getElementById('connectionDateInput');
            if (connectionDateInput) {
                connectionDateInput.value = now;
            }
        }

        // 显示连接信息，使用当前标记点的标题而不是保存时的标题
        const markerCoords = document.getElementById('markerCoords');
        if (markerCoords) {
            // 通过ID找到当前的标记点对象，获取最新的标题
            const startMarker = this.markers.find(m => m.id === connectionData.startId);
            const endMarker = this.markers.find(m => m.id === connectionData.endId);

            const startTitle = startMarker ? startMarker.title : connectionData.startTitle;
            const endTitle = endMarker ? endMarker.title : connectionData.endTitle;

            // 动态计算并添加距离信息（复用上面已找到的startMarker和endMarker）
            let distanceStr = '';
            if (startMarker && endMarker) {
                const distance = this.calculateLineDistance(startMarker.position, endMarker.position);
                if (distance > 1000) {
                    distanceStr = ` | 距离: ${(distance / 1000).toFixed(2)} km`;
                } else {
                    distanceStr = ` | 距离: ${Math.round(distance)} m`;
                }
            }

            markerCoords.textContent =
                `${startTitle} → ${endTitle} (${this.getTransportIcon(connectionData.transportType)} ${this.getTransportTypeName(connectionData.transportType)})${distanceStr}`;
        }

        // 设置耗时
        const durationInput = document.getElementById('connectionDuration');
        if (durationInput) {
            durationInput.value = connectionData.duration || 0;
        }

        // 显示标注内容
        const labelsContent = connectionData.label || '';
        const connectionLabelsInput = document.getElementById('connectionLabelsInput');
        if (connectionLabelsInput) {
            connectionLabelsInput.value = labelsContent;
        }

        // 设置当前交通方式的激活状态
        document.querySelectorAll('#connectionDetailPanel .transport-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.transport === connectionData.transportType) {
                btn.classList.add('active');
            }
        });

        // 填充起始点和终点选择框
        const startSelect = document.getElementById('connectionStartMarker');
        const endSelect = document.getElementById('connectionEndMarker');

        if (startSelect && endSelect) {
            startSelect.innerHTML = '';
            endSelect.innerHTML = '';

            this.markers.forEach((marker, index) => {
                const optionStart = new Option(marker.title, index);
                const optionEnd = new Option(marker.title, index);

                // 通过ID查找当前连接的起始点和终点，并高亮
                const startMarker = this.markers.find(m => m.id === connectionData.startId);
                const endMarker = this.markers.find(m => m.id === connectionData.endId);

                if (startMarker && marker.id === startMarker.id) {
                    optionStart.selected = true;
                }
                if (endMarker && marker.id === endMarker.id) {
                    optionEnd.selected = true;
                }

                startSelect.add(optionStart);
                endSelect.add(optionEnd);
            });
        }

        // 生成导航链接
        this.updateNavigationLinks(connectionData);

        // 隐藏标记点详情面板，显示连接线详情面板
        const markerDetailPanel = document.getElementById('markerDetailPanel');
        if (markerDetailPanel) {
            markerDetailPanel.style.display = 'none';
        }
        const connectionDetailPanel = document.getElementById('connectionDetailPanel');
        if (connectionDetailPanel) {
            connectionDetailPanel.style.display = 'block';
        }
    }

    // 更新导航链接
    updateNavigationLinks(connectionData) {
        // 通过ID找到当前的标记点对象，获取最新的位置信息
        const startMarker = this.markers.find(m => m.id === connectionData.startId);
        const endMarker = this.markers.find(m => m.id === connectionData.endId);

        if (!startMarker || !endMarker) {
            console.error('无法找到起始或终点标记点');
            return;
        }

        // 获取起始点和终点的坐标
        const startLat = startMarker.position[0];
        const startLng = startMarker.position[1];
        const endLat = endMarker.position[0];
        const endLng = endMarker.position[1];

        // 获取起始点和终点的名称
        const startTitle = startMarker.title || '起点';
        const endTitle = endMarker.title || '终点';

        // 生成百度导航链接
        const baiduLink = `http://api.map.baidu.com/direction?origin=latlng:${startLat},${startLng}|name:${startTitle}&destination=latlng:${endLat},${endLng}|name:${endTitle}&mode=driving&region=中国&output=html&coord_type=gcj02&src=webapp.demo`;
        const baiduNavLink = document.getElementById('baiduNavLink');
        if (baiduNavLink) {
            baiduNavLink.href = baiduLink;
            baiduNavLink.target = '_blank';
        }

        // 生成高德导航链接
        const amapLink = `https://uri.amap.com/navigation?from=${startLng},${startLat},${startTitle}&to=${endLng},${endLat},${endTitle}&mode=car&policy=1&coordinate=gaode`;
        const amapNavLink = document.getElementById('amapNavLink');
        if (amapNavLink) {
            amapNavLink.href = amapLink;
            amapNavLink.target = '_blank';
        }

        // 生成腾讯导航链接
        const qqLink = `https://apis.map.qq.com/uri/v1/routeplan?type=drive&from=${startTitle}&fromcoord=${startLat},${startLng}&to=${endTitle}&tocoord=${endLat},${endLng}&referer=myapp`;
        const qqNavLink = document.getElementById('qqNavLink');
        if (qqNavLink) {
            qqNavLink.href = qqLink;
            qqNavLink.target = '_blank';
        }
    }

    showLabelModal() {
        if (this.markers.length === 0) {
            alert('需要先添加标记点！');
            return;
        }

        const labelSelect = document.getElementById('labelMarker');
        labelSelect.innerHTML = '';

        this.markers.forEach((marker, index) => {
            const option = new Option(marker.title, index);
            labelSelect.add(option);
        });

        document.getElementById('labelModal').style.display = 'block';
    }

    addLabel() {
        const markerIndex = document.getElementById('labelMarker').selectedIndex;
        const content = document.getElementById('labelContent').value.trim();

        if (!content) {
            alert('请输入标注内容！');
            return;
        }

        const marker = this.markers[markerIndex];

        // 创建自定义标注样式
        const label = L.divIcon({
            className: 'custom-label',
            html: `<div style="background-color: rgba(255,255,255,0.9); border: 2px solid #667eea; border-radius: 5px; padding: 8px; font-size: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 200px;">${content}</div>`,
            iconSize: [200, 'auto'],
            iconAnchor: [100, -10]
        });

        const labelMarker = L.marker([marker.position[0], marker.position[1]], {
            icon: label
        }).addTo(this.map);

        marker.labels.push(labelMarker);
        this.labels.push({ marker: marker, label: labelMarker, content: content });

        document.getElementById('labelContent').value = '';
        this.closeModals();
    }

    updateMarkerList() {
        const listContainer = document.getElementById('markerList');
        listContainer.innerHTML = '';

        // 按日期分组标记点
        const markersByDate = this.groupMarkersByDate();

        // 获取所有日期并排序（从近到远）
        const allDates = this.getAllDatesFromMarkers();

        allDates.forEach(date => {
            // 创建日期分组标题
            const dateHeader = document.createElement('div');
            dateHeader.className = 'date-group-header';
            const markers = markersByDate[date] || [];
            // 默认为收起状态
            if (!this.collapsedDates) this.collapsedDates = {};
            const isCollapsed = (this.collapsedDates[date] !== undefined) ? this.collapsedDates[date] : true;
            const expandIcon = isCollapsed ? '📁' : '📂'; // 收起状态显示📁，展开状态显示📂

            dateHeader.innerHTML = `
                <h4 style="display: flex; align-items: center; gap: 8px;">
                    <span class="expand-toggle">${expandIcon}</span>
                    ${this.formatDateHeader(date)}
                </h4>
                <span class="marker-count">${markers.length} 个地点</span>
            `;

            // 为日期标题添加展开/收起功能，同时保留筛选功能
            dateHeader.style.cursor = 'pointer';
            dateHeader.addEventListener('click', (e) => {
                // 如果点击的是展开/收起按钮，则只执行展开/收起功能
                if (e.target.classList.contains('expand-toggle')) {
                    // 切换展开/收起状态
                    // 如果当前状态未定义（默认状态），则从默认收起状态开始，点击后应该展开（false）
                    // 如果当前状态已定义，则直接取反
                    if (this.collapsedDates[date] === undefined) {
                        this.collapsedDates[date] = false; // 从默认收起切换到展开
                    } else {
                        this.collapsedDates[date] = !this.collapsedDates[date];
                    }
                    // 重新渲染整个列表以更新展开/收起状态
                    this.updateMarkerList();
                } else {
                    // 否则执行筛选功能
                    this.filterByDate(date); // 执行筛选并自动调整视窗
                    // 在筛选后显示日期详情，这样用户可以编辑备注
                    setTimeout(() => {
                        this.showDateDetail(date);
                    }, 300); // 延迟显示详情，让视窗调整完成
                }
            });

            listContainer.appendChild(dateHeader);

            // 按最早时间排序该日期的标记点
            const sortedMarkers = this.sortMarkersByEarliestTime(markers, date);

            // 如果未收起，则显示该日期的标记点 (使用计算后的isCollapsed值)
            if (!isCollapsed) {
                // 添加该日期的所有标记点
                sortedMarkers.forEach(marker => {
                    const item = document.createElement('div');
                    item.className = 'marker-item';

                    // 显示该日期对应的时间点（只显示这一天的）
                    const dayTimes = this.getMarkerTimesForDate(marker, date);
                    const timeDisplay = dayTimes.length > 0
                        ? dayTimes.map(dt => this.formatTime(dt)).join(', ')
                        : '';

                    item.innerHTML = `
                        <div class="marker-info">
                            <div class="title">${marker.title}</div>
                            <div class="coords">${marker.position[1].toFixed(6)}, ${marker.position[0].toFixed(6)}</div>
                            <div class="time-info">${timeDisplay}</div>
                        </div>
                        <div class="marker-actions">
                            <button class="edit-btn" title="编辑">✏️</button>
                            <button class="delete-btn" title="删除">🗑️</button>
                        </div>
                    `;

                    // 点击标记点信息显示详情
                    item.querySelector('.marker-info').addEventListener('click', () => {
                        this.showMarkerDetail(marker);
                    });

                    // 编辑按钮
                    item.querySelector('.edit-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showMarkerDetail(marker);
                    });

                    // 删除按钮
                    item.querySelector('.delete-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (confirm(`确定要删除标记点"${marker.title}"吗？`)) {
                            this.removeMarker(marker);
                        }
                    });

                    listContainer.appendChild(item);
                });
            }
        });
    }

    // 获取所有标记点中出现过的日期（从早到晚排序）
    getAllDatesFromMarkers() {
        const allDates = new Set();

        this.markers.forEach(marker => {
            const markerDates = this.getMarkerAllDates(marker);
            markerDates.forEach(date => {
                if (date !== '未知日期') {
                    allDates.add(date);
                }
            });
        });

        // 转换为数组并按日期排序（从早到晚）
        return Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));
    }

    // 获取标记点在指定日期的时间点
    getMarkerTimesForDate(marker, dateKey) {
        const times = [];

        if (marker.dateTimes && marker.dateTimes.length > 0) {
            marker.dateTimes.forEach(dateTime => {
                const dtDateKey = this.getDateKey(dateTime);
                if (dtDateKey === dateKey) {
                    times.push(dateTime);
                }
            });
        } else if (marker.dateTime) {
            const dtDateKey = this.getDateKey(marker.dateTime);
            if (dtDateKey === dateKey) {
                times.push(marker.dateTime);
            }
        }

        return times;
    }

    // 按最早时间排序标记点（创建副本避免修改原数组）
    sortMarkersByEarliestTime(markers, dateKey) {
        return [...markers].sort((a, b) => {
            // 获取每个标记点在该日期的最早时间
            const aTimes = this.getMarkerTimesForDate(a, dateKey);
            const bTimes = this.getMarkerTimesForDate(b, dateKey);

            if (aTimes.length === 0 && bTimes.length === 0) return 0;
            if (aTimes.length === 0) return 1; // a没有时间，排后面
            if (bTimes.length === 0) return -1; // b没有时间，排后面

            // 按最早时间排序（时间小的在前）
            const aEarliest = new Date(aTimes[0]);
            const bEarliest = new Date(bTimes[0]);

            return aEarliest - bEarliest;
        });
    }

    // 按日期分组标记点 - 包含所有出现过的日期
    groupMarkersByDate() {
        const groups = {};

        this.markers.forEach(marker => {
            // 获取该标记点的所有日期
            const markerDates = this.getMarkerAllDates(marker);

            // 将该标记点添加到它出现的所有日期分组中
            markerDates.forEach(dateKey => {
                if (!groups[dateKey]) {
                    groups[dateKey] = [];
                }
                groups[dateKey].push(marker);
            });
        });

        return groups;
    }

    // 获取标记点所有出现的日期
    getMarkerAllDates(marker) {
        const dates = new Set();

        if (marker.dateTimes && marker.dateTimes.length > 0) {
            marker.dateTimes.forEach(dateTime => {
                const dateKey = this.getDateKey(dateTime);
                if (dateKey !== '未知日期') {
                    dates.add(dateKey);
                }
            });
        } else if (marker.dateTime) {
            const dateKey = this.getDateKey(marker.dateTime);
            if (dateKey !== '未知日期') {
                dates.add(dateKey);
            }
        }

        return Array.from(dates);
    }

    // 获取日期键（YYYY-MM-DD格式）
    getDateKey(dateTimeString) {
        if (!dateTimeString) return '未知日期';
        try {
            const date = new Date(dateTimeString);
            if (isNaN(date.getTime())) return '未知日期';
            // 使用本地时区的日期，而不是UTC
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`; // YYYY-MM-DD in local timezone
        } catch (error) {
            return '未知日期';
        }
    }

    // 格式化日期标题
    formatDateHeader(dateKey) {
        if (dateKey === '未知日期') return dateKey;
        try {
            const date = new Date(dateKey);
            // 获取今天的日期键（本地时区）
            const today = new Date();
            const todayKey = this.getDateKey(today.toISOString());

            // 获取昨天的日期键（本地时区）
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayKey = this.getDateKey(yesterday.toISOString());

            if (dateKey === todayKey) {
                return '今天';
            } else if (dateKey === yesterdayKey) {
                return '昨天';
            } else {
                return `${date.getMonth() + 1}月${date.getDate()}日 (${this.getWeekdayName(date.getDay())})`;
            }
        } catch (error) {
            return dateKey;
        }
    }

    // 获取星期几的中文名称
    getWeekdayName(day) {
        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return weekdays[day];
    }

    // 格式化时间（只在小时或分钟不为0时显示）
    formatTime(dateTimeString) {
        if (!dateTimeString) return '';
        try {
            const date = new Date(dateTimeString);
            if (isNaN(date.getTime())) return '';

            // 检查小时和分钟是否为0
            const hours = date.getHours();
            const minutes = date.getMinutes();

            // 如果小时和分钟都为0，则只显示日期部分
            if (hours === 0 && minutes === 0) {
                // 只返回日期部分
                return date.toLocaleDateString('zh-CN');
            } else {
                // 显示日期和时间（时:分）
                return date.toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
            }
        } catch (error) {
            return '';
        }
    }

    // 按日期筛选功能
    filterByDate(date) {
        this.filterMode = true;
        this.filteredDate = date;

        console.log(`进入日期筛选模式: ${date}`);

        // 隐藏所有标记点
        this.markers.forEach(marker => {
            marker.marker.remove();
        });

        // 隐藏所有连接线
        this.connections.forEach(connection => {
            connection.polyline.remove();
            if (connection.endCircle) connection.endCircle.remove();
            if (connection.iconMarker) connection.iconMarker.remove();
            if (connection.arrowHead) connection.arrowHead.remove();
        });

        // 显示筛选日期内的标记点
        this.markers.forEach(marker => {
            const markerDates = this.getMarkerAllDates(marker);
            if (markerDates.includes(date)) {
                marker.marker.addTo(this.map);
            }
        });

        // 显示筛选日期内的连接线
        this.connections.forEach(connection => {
            const connectionDate = this.getDateKey(connection.dateTime);
            if (connectionDate === date) {
                connection.polyline.addTo(this.map);
                if (connection.endCircle) connection.endCircle.addTo(this.map);
                if (connection.iconMarker) connection.iconMarker.addTo(this.map);
                if (connection.arrowHead) connection.arrowHead.addTo(this.map);
            }
        });

        // 更新标记点列表显示
        this.updateMarkerListForFilter();

        // 显示筛选模式提示
        this.showFilterModeIndicator(date);

        // 绑定退出筛选模式的事件
        this.bindFilterExitEvents();

        // 自动调整视窗以聚焦到筛选后的元素
        this.autoFitMapViewAfterFilter();

        // 显示日期备注便签
        this.showDateNotesSticky(date);
    }

    // 显示筛选模式提示
    showFilterModeIndicator(date) {
        const headerTitle = document.querySelector('header h1');
        if (headerTitle) {
            const originalText = headerTitle.textContent;
            const dateHeader = this.formatDateHeader(date);
            headerTitle.innerHTML = `${originalText} <span style="font-size: 0.8rem; background: rgba(255,255,255,0.2); padding: 0.2rem 0.5rem; border-radius: 10px; margin-left: 1rem;">📅 ${dateHeader} 筛选模式</span>`;
            headerTitle.style.cursor = 'pointer';
            headerTitle.title = '点击退出筛选模式';

            // 添加点击标题退出筛选模式
            headerTitle.onclick = () => {
                this.exitFilterMode();
            };
        }
    }

    // 绑定退出筛选模式的事件
    bindFilterExitEvents() {
        // 点击地图退出筛选模式
        this.map.on('click', this.exitFilterModeHandler, this);

        // ESC键退出筛选模式
        document.addEventListener('keydown', this.exitFilterModeKeyHandler, true);

        // 点击任意按钮退出筛选模式
        document.querySelectorAll('.btn').forEach(btn => {
            btn.addEventListener('click', this.exitFilterModeClickHandler, true);
        });
    }

    // 显示日期备注便签
    showDateNotesSticky(date) {
        const sticky = document.getElementById('dateNotesSticky');
        const dateElement = document.getElementById('dateNotesDate');
        const contentElement = document.getElementById('dateNotesContent');

        if (sticky && dateElement && contentElement) {
            // 设置日期标题
            dateElement.textContent = this.formatDateHeader(date);

            // 获取日期备注
            const notes = this.getDateNotes(date);
            contentElement.textContent = notes || '暂无备注';

            // 显示便签
            sticky.style.display = 'flex';

            // 阻止滚动事件冒泡到地图，防止在备注内容区域滚动时影响地图
            contentElement.addEventListener('wheel', function(e) {
                const scrollTop = this.scrollTop;
                const scrollHeight = this.scrollHeight;
                const clientHeight = this.clientHeight;

                // 检查是否滚动到了顶部或底部
                const isScrollAtTop = (scrollTop === 0 && e.deltaY < 0);
                const isScrollAtBottom = (scrollTop + clientHeight >= scrollHeight && e.deltaY > 0);

                // 如果已经滚动到了顶部或底部，允许事件继续传播以影响地图
                // 否则阻止事件传播，只在便签内容内部滚动
                if (!isScrollAtTop && !isScrollAtBottom) {
                    e.stopPropagation();
                }
            });
        }
    }

    // 隐藏日期备注便签
    hideDateNotesSticky() {
        const sticky = document.getElementById('dateNotesSticky');
        if (sticky) {
            sticky.style.display = 'none';
        }
    }

    // 退出筛选模式的处理器
    exitFilterModeHandler(e) {
        if (e.originalEvent) {
            this.exitFilterMode(false); // 点击地图退出筛选模式时不自动调整视图
        }
    }

    exitFilterModeKeyHandler(e) {
        if (e.key === 'Escape') {
            this.exitFilterMode(); // ESC键退出筛选模式时自动调整视图
        }
    }

    exitFilterModeClickHandler(_e) {
        this.exitFilterMode(); // 按钮点击退出筛选模式时自动调整视图
    }

    // 退出筛选模式
    exitFilterMode(shouldFitView = true) {
        if (!this.filterMode) return;

        console.log('退出日期筛选模式');

        // 如果日期详情面板是打开的，手动保存内容并关闭面板（防止递归调用）
        const dateNotesInput = document.getElementById('dateNotesInput');
        if (dateNotesInput && this.currentDate) {
            // 手动保存备注内容
            if (!this.dateNotes) {
                this.dateNotes = {};
            }
            const notes = dateNotesInput.value.trim();
            this.dateNotes[this.currentDate] = notes;

            // 保存到本地存储
            this.saveToLocalStorage();

            // 隐藏日期详情面板
            const dateDetailPanel = document.getElementById('dateDetailPanel');
            if (dateDetailPanel) {
                dateDetailPanel.style.display = 'none';
            }

            // 清除当前状态
            this.currentDate = null;
            this.currentMarker = null;
            this.currentConnection = null;
        }

        this.filterMode = false;
        this.filteredDate = null;

        // 恢复所有标记点显示
        this.markers.forEach(marker => {
            marker.marker.addTo(this.map);
        });

        // 恢复所有连接线显示
        this.connections.forEach(connection => {
            connection.polyline.addTo(this.map);
            if (connection.endCircle) connection.endCircle.addTo(this.map);
            if (connection.iconMarker) connection.iconMarker.addTo(this.map);
            if (connection.arrowHead) connection.arrowHead.addTo(this.map);
        });

        // 恢复标记点列表显示
        this.updateMarkerList();

        // 恢复标题
        const headerTitle = document.querySelector('header h1');
        if (headerTitle) {
            headerTitle.textContent = '路书制作工具';
            headerTitle.style.cursor = 'default';
            headerTitle.title = '';
            headerTitle.onclick = null;
        }

        // 移除事件监听
        this.map.off('click', this.exitFilterModeHandler, this);
        document.removeEventListener('keydown', this.exitFilterModeKeyHandler, true);
        document.querySelectorAll('.btn').forEach(btn => {
            btn.removeEventListener('click', this.exitFilterModeClickHandler, true);
        });

        // 隐藏日期备注便签（自动关闭并保存）
        this.hideDateNotesSticky();

        // 退出筛选模式后根据参数决定是否调整视图
        if (shouldFitView) {
            setTimeout(() => {
                this.autoFitMapView();
            }, 100); // 稍微延时以确保所有元素都已重新添加到地图
        }
    }

    // 处理调整视窗按钮点击事件
    handleFitViewClick() {
        console.log('用户点击了调整视窗按钮');

        const fitViewBtn = document.getElementById('fitViewBtn');
        if (fitViewBtn) {
            // 添加点击动画效果
            fitViewBtn.classList.add('active');
            fitViewBtn.classList.add('rotating');

            setTimeout(() => {
                fitViewBtn.classList.remove('active');
            }, 600);

            setTimeout(() => {
                fitViewBtn.classList.remove('rotating');
            }, 1000);
        }

        // 执行视窗调整
        this.autoFitMapView();
    }

    // 更新筛选模式下的标记点列表
    updateMarkerListForFilter() {
        const listContainer = document.getElementById('markerList');
        listContainer.innerHTML = '';

        if (this.filteredDate) {
            // 创建筛选模式标题
            const filterHeader = document.createElement('div');
            filterHeader.className = 'date-group-header';
            filterHeader.innerHTML = `
                <h4>📅 ${this.formatDateHeader(this.filteredDate)} 筛选结果</h4>
                <span class="marker-count">筛选模式</span>
            `;
            filterHeader.style.cursor = 'pointer';
            filterHeader.title = '点击退出筛选模式';
            filterHeader.addEventListener('click', () => {
                this.exitFilterMode();
            });
            listContainer.appendChild(filterHeader);

            // 显示筛选日期内的标记点
            const filteredMarkers = this.markers.filter(marker => {
                const markerDates = this.getMarkerAllDates(marker);
                return markerDates.includes(this.filteredDate);
            });

            // 按时间排序
            const sortedMarkers = this.sortMarkersByEarliestTime(filteredMarkers, this.filteredDate);

            sortedMarkers.forEach(marker => {
                const item = document.createElement('div');
                item.className = 'marker-item';

                const dayTimes = this.getMarkerTimesForDate(marker, this.filteredDate);
                const timeDisplay = dayTimes.length > 0
                    ? dayTimes.map(dt => this.formatTime(dt)).join(', ')
                    : '';

                item.innerHTML = `
                    <div class="marker-info">
                        <div class="title">${marker.title}</div>
                        <div class="coords">${marker.position[1].toFixed(6)}, ${marker.position[0].toFixed(6)}</div>
                        <div class="time-info">${timeDisplay}</div>
                    </div>
                    <div class="marker-actions">
                        <button class="edit-btn" title="编辑">✏️</button>
                        <button class="delete-btn" title="删除">🗑️</button>
                    </div>
                `;

                item.querySelector('.marker-info').addEventListener('click', () => {
                    this.showMarkerDetail(marker);
                });

                item.querySelector('.edit-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showMarkerDetail(marker);
                });

                item.querySelector('.delete-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`确定要删除标记点"${marker.title}"吗？`)) {
                        this.removeMarker(marker);
                    }
                });

                listContainer.appendChild(item);
            });
        }
    }

    updateConnections() {
        this.connections.forEach(conn => {
            // 通过ID获取当前的起始点和终点对象
            const startMarker = this.markers.find(m => m.id === conn.startId);
            const endMarker = this.markers.find(m => m.id === conn.endId);

            if (!startMarker || !endMarker || !startMarker.position || !endMarker.position) {
                console.warn('连接线数据不完整:', conn);
                return;
            }

            const startLat = parseFloat(startMarker.position[0]);
            const startLng = parseFloat(startMarker.position[1]);
            const endLat = parseFloat(endMarker.position[0]);
            const endLng = parseFloat(endMarker.position[1]);

            if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
                console.error('连接线坐标无效:', startMarker.position, endMarker.position);
                return;
            }

            const newPath = [
                [startLat, startLng],
                [endLat, endLng]
            ];
            conn.polyline.setLatLngs(newPath);

            // 更新终点圆点位置
            if (conn.endCircle) {
                conn.endCircle.setLatLng([endLat, endLng]);
            }

            // 更新图标位置（中点）
            if (conn.iconMarker) {
                const midLat = (startLat + endLat) / 2;
                const midLng = (startLng + endLng) / 2;
                conn.iconMarker.setLatLng([midLat, midLng]);
            }

            // 更新箭头位置
            if (conn.arrowHead) {
                const newArrow = this.createArrowHead(startMarker.position, endMarker.position, conn.transportType);
                conn.arrowHead.remove();
                conn.arrowHead = newArrow;
                conn.arrowHead.addTo(this.map);
            }
        });
    }

    updateLabels() {
        this.labels.forEach(labelData => {
            labelData.label.setLatLng([labelData.marker.position[0], labelData.marker.position[1]]);
        });
    }

    // 保存到本地存储
    saveToLocalStorage() {
        const data = {
            version: 'localStorage-v2.0',
            saveTime: new Date().toISOString(),
            currentLayer: this.currentLayer, // 保存当前地图源
            currentSearchMethod: this.currentSearchMethod, // 保存当前搜索方式
            markers: this.markers.map((m) => ({
                id: m.id,
                position: m.position,
                title: m.title,
                labels: m.labels, // 现在labels是字符串数组，直接导出
                createdAt: m.createdAt,
                dateTimes: m.dateTimes || [m.dateTime], // 导出多个时间点
                icon: m.icon // 导出图标信息
            })),
            connections: this.connections.map(c => {
                // 通过ID获取实际的标记点对象（为了兼容性）
                const startMarker = this.markers.find(m => m.id === c.startId);
                const endMarker = this.markers.find(m => m.id === c.endId);

                return {
                    id: c.id,
                    startId: c.startId, // 使用ID而不是索引
                    endId: c.endId,     // 使用ID而不是索引
                    transportType: c.transportType,
                    dateTime: c.dateTime,
                    label: c.label,
                    duration: c.duration || 0, // 保存耗时信息
                    startTitle: startMarker ? startMarker.title : c.startTitle,
                    endTitle: endMarker ? endMarker.title : c.endTitle
                };
            }),
            labels: this.labels.map(l => ({
                markerIndex: this.markers.indexOf(l.marker),
                content: l.content
            })),
            dateNotes: this.dateNotes || {} // 保存日期备注信息
        };

        try {
            console.log('开始保存到本地存储，标记点数量:', this.markers.length);
            if (this.markers.length > 0) {
                this.markers.forEach((marker, index) => {
                    console.log(`保存标记点 ${index}: ID=${marker.id}, 位置=${marker.position}, 标题=${marker.title}`);
                });
            }

            localStorage.setItem('roadbookData', JSON.stringify(data));
            console.log('路书数据已保存到本地存储');

            // 验证保存的数据
            const savedData = localStorage.getItem('roadbookData');
            const parsedData = JSON.parse(savedData);
            console.log('验证保存的数据:', parsedData);
        } catch (error) {
            console.error('保存到本地存储失败:', error);
        }
    }

    // 从本地存储加载数据
    loadFromLocalStorage() {
        try {
            const savedData = localStorage.getItem('roadbookData');
            if (savedData) {
                const data = JSON.parse(savedData);
                console.log('从本地存储加载路书数据');
                console.log('本地存储数据:', data);

                // 检查标记点位置数据
                if (data.markers && data.markers.length > 0) {
                    data.markers.forEach((marker, index) => {
                        console.log(`标记点 ${index}: ID=${marker.id}, 位置=${marker.position}, 标题=${marker.title}`);
                    });
                }

                // 直接加载本地缓存数据，不显示导入提示
                this.loadRoadbook(data, false);

                // 加载日期备注信息
                if (data.dateNotes) {
                    this.dateNotes = data.dateNotes;
                } else {
                    this.dateNotes = {};
                }

                // 恢复地图源和搜索方式（如果存在）
                // 注意：我们先更新内部状态，然后再更新UI，避免触发change事件
                if (data.currentLayer) {
                    this.currentLayer = data.currentLayer; // 先更新内部状态
                    this.switchMapSourceWithoutSaving(data.currentLayer); // 然后切换图层
                }

                if (data.currentSearchMethod) {
                    this.currentSearchMethod = data.currentSearchMethod;
                }

                // 标记正在更新UI，避免触发保存事件
                this.updatingUI = true;

                // 确保UI下拉框立即显示正确的值，但要避免触发change事件
                this.updateUISelectsNoEvent(data.currentLayer, data.currentSearchMethod);

                // 延迟清除标记，确保UI更新完成
                setTimeout(() => {
                    this.updatingUI = false;
                }, 100);

                // 延迟执行自动调整视窗，确保所有元素都已渲染
                setTimeout(() => {
                    this.autoFitMapView();
                }, 500);
            } else {
                console.log('没有找到本地缓存数据');

                // 确保UI下拉框显示默认值
                this.updateUISelectsNoEvent(this.currentLayer, this.currentSearchMethod);
            }
        } catch (error) {
            console.error('从本地存储加载数据失败:', error);
        }
    }

    // 不保存到本地存储的切换地图源方法，避免在加载缓存时触发事件
    switchMapSourceWithoutSaving(newSource) {
        if (!this.mapLayers[newSource]) {
            console.error('不支持的地图源:', newSource);
            return;
        }

        // 移除当前图层
        if (this.currentLayer && this.mapLayers[this.currentLayer]) {
            this.map.removeLayer(this.mapLayers[this.currentLayer]);
        }

        // 切换到新图层
        this.currentLayer = newSource;
        this.mapLayers[this.currentLayer].addTo(this.map);

        // 更新搜索框状态
        this.updateSearchInputState();

        console.log('地图源已切换到:', newSource);
    }

    // 更新UI下拉框的辅助方法，不触发事件
    updateUISelectsNoEvent(currentLayer, currentSearchMethod) {
        // 确保DOM元素存在后再更新
        if (document.readyState === 'loading') {
            // 如果DOM还未完全加载，等待加载完成
            document.addEventListener('DOMContentLoaded', () => {
                this.setSelectValuesNoEvent(currentLayer, currentSearchMethod);
            });
        } else {
            // DOM已加载，直接更新
            this.setSelectValuesNoEvent(currentLayer, currentSearchMethod);
        }
    }

    // 设置下拉框值的辅助方法，不触发change事件
    setSelectValuesNoEvent(currentLayer, currentSearchMethod) {
        const mapSourceSelect = document.getElementById('mapSourceSelect');
        if (mapSourceSelect) {
            // 使用传入的值或当前值或默认值
            const layer = currentLayer || this.currentLayer || 'osm';
            mapSourceSelect.value = layer;
        }

        const searchMethodSelect = document.getElementById('searchMethodSelect');
        if (searchMethodSelect) {
            // 使用传入的值或当前值或默认值
            const method = currentSearchMethod || this.currentSearchMethod || 'auto';
            searchMethodSelect.value = method;
        }
    }

    // 搜索地点
    searchLocation(query) {
        if (!query.trim()) {
            // 隐藏搜索结果下拉框
            const searchResults = document.getElementById('searchResults');
            if (searchResults) {
                searchResults.style.display = 'none';
            }
            return;
        }

        // 使用当前选择的搜索方法
        let searchConfig;

        if (this.currentSearchMethod === 'auto') {
            // 自动模式：检查当前地图是否支持搜索
            const currentMapConfig = this.mapSearchConfig[this.currentLayer];
            if (!currentMapConfig || !currentMapConfig.searchable) {
                // 显示地图不支持搜索的提示
                const searchResults = document.getElementById('searchResults');
                if (searchResults) {
                    const resultsList = document.getElementById('resultsList');
                    if (resultsList) {
                        resultsList.innerHTML = `<li style="padding: 12px 15px; color: #999; cursor: default;">当前地图(${currentMapConfig.name})不支持地点搜索</li>`;
                    }
                    searchResults.style.display = 'block';
                }
                return;
            }
            searchConfig = currentMapConfig;
        } else if (this.currentSearchMethod === 'nominatim') {
            // Nominatim搜索模式
            searchConfig = {
                searchable: true,
                searchUrl: 'https://nominatim.openstreetmap.org/search',
                params: {
                    format: 'json',
                    limit: 10
                },
                parser: 'nominatim'
            };
        } else if (this.currentSearchMethod === 'overpass') {
            // Overpass搜索模式
            searchConfig = {
                searchable: true,
                searchUrl: 'https://overpass-api.de/api/interpreter',
                parser: 'overpass'
            };
        } else if (this.currentSearchMethod === 'photon') {
            // Photon搜索模式（原Google搜索）
            searchConfig = {
                searchable: true,
                searchUrl: 'https://photon.komoot.io/api/',
                params: {
                    limit: 10
                },
                parser: 'photon'
            };
        } else if (this.currentSearchMethod === 'mapsearch') {
            // MapSearch搜索模式
            searchConfig = {
                searchable: true,
                searchUrl: 'https://map.011203.dpdns.org/search',
                params: {
                    format: 'json',
                    limit: 10
                },
                parser: 'nominatim' // 使用Nominatim格式，因为MapSearch与Nominatim格式一致
            };
        } else if (this.currentSearchMethod === 'cnsearch') {
            // CNSearch搜索模式
            searchConfig = {
                searchable: true,
                searchUrl: 'https://map.chenxuanweb.top/api/cnmap/search',
                params: {
                    format: 'json',
                    limit: 10
                },
                parser: 'nominatim' // 使用Nominatim格式，因为CNSearch与Nominatim格式一致
            };
        } else if (this.currentSearchMethod === 'tiansearch') {
            // TianSearch搜索模式
            searchConfig = {
                searchable: true,
                searchUrl: 'https://map.chenxuanweb.top/api/tianmap/search',
                params: {
                    format: 'json',
                    limit: 10
                },
                parser: 'nominatim' // 使用Nominatim格式，因为TianSearch与Nominatim格式一致
            };
        }

        let url, searchPromise;

        if (searchConfig.parser === 'overpass') {
            // 构建Overpass API查询 - 使用英文搜索
            const overpassQuery = `[out:json];(
                node['name:en'~'${query}',i]['place'~'city|town|village'];
                node['name:zh'~'${query}',i]['place'~'city|town|village'];
                node['name'~'${query}',i]['place'~'city|town|village'];
                way['name:en'~'${query}',i]['place'~'city|town|village'];
                way['name:zh'~'${query}',i]['place'~'city|town|village'];
                way['name'~'${query}',i]['place'~'city|town|village'];
                relation['name:en'~'${query}',i]['place'~'city|town|village'];
                relation['name:zh'~'${query}',i]['place'~'city|town|village'];
                relation['name'~'${query}',i]['place'~'city|town|village'];
            );out center;`;

            url = `${searchConfig.searchUrl}?data=${encodeURIComponent(overpassQuery)}`;
            searchPromise = fetch(url).then(response => response.json()).then(data => {
                if (data && data.elements && data.elements.length > 0) {
                    return this.convertOverpassToSearchResults(data.elements);
                }
                return [];
            });
        } else {
            // 原有的Nominatim/Photon搜索逻辑
            const params = new URLSearchParams({
                ...searchConfig.params,
                q: query
            });

            url = `${searchConfig.searchUrl}?${params.toString()}`;
            searchPromise = fetch(url).then(response => response.json());
        }

        searchPromise
            .then(data => {
                if (data && data.length > 0) {
                    this.showSearchResults(data);
                } else if (data && data.features && data.features.length > 0) {
                    // Photon服务返回的是GeoJSON格式
                    this.showPhotonSearchResults(data.features);
                } else {
                    // 没有找到结果，显示提示
                    const searchResults = document.getElementById('searchResults');
                    if (searchResults) {
                        const resultsList = document.getElementById('resultsList');
                        if (resultsList) {
                            resultsList.innerHTML = '<li style="padding: 12px 15px; color: #999; cursor: default;">未找到相关地点，请尝试其他关键词</li>';
                        }
                        searchResults.style.display = 'block';
                    }
                }
            })
            .catch(error => {
                console.error('搜索地点时出错:', error);
                // 显示错误信息
                const searchResults = document.getElementById('searchResults');
                if (searchResults) {
                    const resultsList = document.getElementById('resultsList');
                    if (resultsList) {
                        resultsList.innerHTML = '<li style="padding: 12px 15px; color: #999; cursor: default;">搜索失败，请检查网络连接</li>';
                    }
                    searchResults.style.display = 'block';
                }
            });
    }

    // 显示Photon搜索结果下拉框
    showPhotonSearchResults(features) {
        const searchResults = document.getElementById('searchResults');
        const resultsList = document.getElementById('resultsList');

        if (!searchResults || !resultsList) return;

        // 清空现有结果
        resultsList.innerHTML = '';

        // 添加搜索结果到列表
        features.forEach((feature) => {
            const li = document.createElement('li');
            const name = feature.properties.name || feature.properties.street || '未知地点';
            const city = feature.properties.city || '';
            const country = feature.properties.country || '';

            let address = '';
            if (city && country) {
                address = `${city}, ${country}`;
            } else if (city) {
                address = city;
            } else if (country) {
                address = country;
            }

            li.innerHTML = `
                <div class="result-title">${name}</div>
                <div class="result-address">${address || '地点'}</div>
            `;

            // 添加点击事件
            li.addEventListener('click', () => {
                this.selectPhotonSearchResult(feature);
            });

            resultsList.appendChild(li);
        });

        // 显示搜索结果下拉框
        searchResults.style.display = 'block';
    }

    // 选择Photon搜索结果
    selectPhotonSearchResult(feature) {
        const coordinates = feature.geometry.coordinates;
        const lat = coordinates[1];
        const lon = coordinates[0];

        if (!isNaN(lat) && !isNaN(lon)) {
            // 聚焦到搜索结果位置
            this.map.setView([lat, lon], 15); // 缩放级别15适合城市级别

            // 在搜索结果位置添加一个临时标记点来显示结果
            if (this.searchMarker) {
                this.map.removeLayer(this.searchMarker);
            }

            const name = feature.properties.name || feature.properties.street || '搜索结果';
            this.searchMarker = L.marker([lat, lon])
                .addTo(this.map)
                .bindPopup(name)
                .openPopup();

            // 3秒后自动关闭弹窗
            if (this.searchPopupTimeout) {
                clearTimeout(this.searchPopupTimeout);
            }
            this.searchPopupTimeout = setTimeout(() => {
                if (this.searchMarker) {
                    this.map.closePopup(this.searchMarker.getPopup());
                }
                this.searchPopupTimeout = null;
            }, 3000);

            // 隐藏搜索结果下拉框
            const searchResults = document.getElementById('searchResults');
            if (searchResults) {
                searchResults.style.display = 'none';
            }

            console.log(`已选择Photon搜索结果: ${name} (${lat}, ${lon})`);
        } else {
            alert('未能获取有效的地理位置信息');
        }
    }

    // 转换Overpass API结果为标准格式
    convertOverpassToSearchResults(elements) {
        return elements.map(element => {
            let lat, lon, name, display_name;

            if (element.type === 'node') {
                lat = element.lat;
                lon = element.lon;
            } else if (element.type === 'way' || element.type === 'relation') {
                // 对于way和relation，使用center坐标
                if (element.center) {
                    lat = element.center.lat;
                    lon = element.center.lon;
                }
            }

            // 获取名称
            if (element.tags) {
                name = element.tags.name || element.tags['name:zh'] || element.tags['name:en'] || '未知地点';

                // 构建显示名称
                display_name = name;
                if (element.tags['addr:city']) {
                    display_name += `, ${element.tags['addr:city']}`;
                }
                if (element.tags['addr:country']) {
                    display_name += `, ${element.tags['addr:country']}`;
                }
            }

            return {
                lat: lat,
                lon: lon,
                display_name: display_name || name,
                name: name,
                type: element.tags && element.tags.place ? element.tags.place : 'unknown'
            };
        }).filter(result => result.lat && result.lon); // 只保留有坐标的结果
    }

    // 显示搜索结果下拉框
    showSearchResults(results) {
        const searchResults = document.getElementById('searchResults');
        const resultsList = document.getElementById('resultsList');

        if (!searchResults || !resultsList) return;

        // 清空现有结果
        resultsList.innerHTML = '';

        // 添加搜索结果到列表
        results.forEach((result) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div class="result-title">${result.display_name}</div>
                <div class="result-address">${result.type || result.class || '地点'}</div>
            `;

            // 添加点击事件
            li.addEventListener('click', () => {
                this.selectSearchResult(result);
            });

            resultsList.appendChild(li);
        });

        // 显示搜索结果下拉框
        searchResults.style.display = 'block';
    }

    // 选择搜索结果
    selectSearchResult(result) {
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);

        if (!isNaN(lat) && !isNaN(lon)) {
            // 聚焦到搜索结果位置
            this.map.setView([lat, lon], 15); // 缩放级别15适合城市级别

            // 在搜索结果位置添加一个临时标记点来显示结果
            if (this.searchMarker) {
                this.map.removeLayer(this.searchMarker);
            }

            this.searchMarker = L.marker([lat, lon])
                .addTo(this.map)
                .bindPopup(result.display_name)
                .openPopup();

            // 3秒后自动关闭弹窗
            if (this.searchPopupTimeout) {
                clearTimeout(this.searchPopupTimeout);
            }
            this.searchPopupTimeout = setTimeout(() => {
                if (this.searchMarker) {
                    this.map.closePopup(this.searchMarker.getPopup());
                }
                this.searchPopupTimeout = null;
            }, 3000);

            // 隐藏搜索结果下拉框
            const searchResults = document.getElementById('searchResults');
            if (searchResults) {
                searchResults.style.display = 'none';
            }

            console.log(`已选择搜索结果: ${result.display_name} (${lat}, ${lon})`);
        } else {
            alert('未能获取有效的地理位置信息');
        }
    }

    clearCache() {
        if (confirm('确定要清除本地缓存吗？此操作将删除所有已保存的数据，无法恢复。')) {
            try {
                localStorage.removeItem('roadbookData');
                // 清除当前数据
                this.clearAll();
                alert('本地缓存已清除！');
            } catch (error) {
                console.error('清除本地缓存失败:', error);
                alert('清除本地缓存失败！');
            }
        }
    }

    exportRoadbook() {
        const data = {
            version: '2.0',
            exportTime: new Date().toISOString(),
            currentLayer: this.currentLayer, // 导出当前地图源
            currentSearchMethod: this.currentSearchMethod, // 导出当前搜索方式
            markers: this.markers.map((m) => ({
                id: m.id,
                position: m.position,
                title: m.title,
                labels: m.labels, // 现在labels是字符串数组，直接导出
                createdAt: m.createdAt,
                dateTimes: m.dateTimes || [m.dateTime], // 导出多个时间点
                icon: m.icon // 导出图标信息
            })),
            connections: this.connections.map(c => {
                // 通过ID获取实际的标记点对象（为了兼容性）
                const startMarker = this.markers.find(m => m.id === c.startId);
                const endMarker = this.markers.find(m => m.id === c.endId);

                return {
                    id: c.id,
                    startId: c.startId, // 使用ID而不是索引
                    endId: c.endId,     // 使用ID而不是索引
                    transportType: c.transportType,
                    dateTime: c.dateTime,
                    label: c.label,
                    duration: c.duration || 0, // 保存耗时信息
                    startTitle: startMarker ? startMarker.title : c.startTitle,
                    endTitle: endMarker ? endMarker.title : c.endTitle
                };
            }),
            labels: this.labels.map(l => ({
                markerIndex: this.markers.indexOf(l.marker),
                content: l.content
            })),
            dateNotes: this.dateNotes || {} // 包含日期备注信息
        };

        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `roadbook_${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`;
        a.click();

        URL.revokeObjectURL(url);
    }



    importRoadbook(file) {
        if (!file) return;

        // 检查是否是HTML文件
        if (file.name.toLowerCase().endsWith('.html') || file.name.toLowerCase().endsWith('.htm')) {
            // If html_export.js is loaded, use the new module
            if (typeof RoadbookHtmlExporter !== 'undefined' && window.htmlExporter) {
                window.htmlExporter.importFromHtml(file);
            } else {
                this.importFromHtml(file); // fallback to old method
            }
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);

                // 调用loadRoadbook方法加载数据
                this.loadRoadbook(data, true); // 明确指定这是手动导入

                // 确保UI下拉框显示正确的值（导入后）
                setTimeout(() => {
                    if (data.currentLayer) {
                        this.switchMapSource(data.currentLayer);
                        const mapSourceSelect = document.getElementById('mapSourceSelect');
                        if (mapSourceSelect) {
                            mapSourceSelect.value = data.currentLayer;
                        }
                    }

                    if (data.currentSearchMethod) {
                        this.currentSearchMethod = data.currentSearchMethod;
                        const searchMethodSelect = document.getElementById('searchMethodSelect');
                        if (searchMethodSelect) {
                            searchMethodSelect.value = data.currentSearchMethod;
                        }
                    }
                }, 100); // 稍微延时以确保数据加载完成

            } catch (error) {
                alert('文件格式错误！');
            }
        };
        reader.readAsText(file);
    }

    importFromHtml(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const htmlContent = e.target.result;

                // 从HTML中提取嵌入的JSON数据 - 适配新的编码方式
                // 查找使用encodeURIComponent和decodeURIComponent编码的数据
                let dataMatch = htmlContent.match(/const roadbookData = JSON\.parse\(decodeURIComponent\(`([^`]*)`\)\);/);

                if (!dataMatch) {
                    // 尝试匹配旧的格式作为备选
                    dataMatch = htmlContent.match(/const roadbookData = JSON\.parse\(`([^`\\]*(\\.[^`\\]*)*)`\)/);

                    if (!dataMatch) {
                        alert('HTML文件中未找到路书数据！');
                        return;
                    }

                    // 解析旧格式的数据
                    const dataStr = dataMatch[1].replace(/\\`/g, '`');
                    const data = JSON.parse(dataStr);
                    this.processImportedData(data);
                    return;
                }

                // 解析新编码格式的数据
                const encodedDataStr = dataMatch[1];
                // 修复反斜杠转义问题
                const properlyDecodedStr = encodedDataStr.replace(/\\`/g, '`');
                const decodedDataStr = decodeURIComponent(properlyDecodedStr);
                const data = JSON.parse(decodedDataStr);

                this.processImportedData(data);

            } catch (error) {
                console.error('导入HTML失败:', error);
                alert('HTML文件格式错误或数据损坏！');
            }
        };
        reader.readAsText(file);
    }

    processImportedData(data) {
        // 调用loadRoadbook方法加载数据
        this.loadRoadbook(data, true); // 明确指定这是手动导入

        // 确保UI下拉框显示正确的值（导入后）
        setTimeout(() => {
            if (data.currentLayer) {
                this.switchMapSource(data.currentLayer);
                const mapSourceSelect = document.getElementById('mapSourceSelect');
                if (mapSourceSelect) {
                    mapSourceSelect.value = data.currentLayer;
                }
            }

            if (data.currentSearchMethod) {
                this.currentSearchMethod = data.currentSearchMethod;
                const searchMethodSelect = document.getElementById('searchMethodSelect');
                if (searchMethodSelect) {
                    searchMethodSelect.value = data.currentSearchMethod;
                }
            }
        }, 100); // 稍微延时以确保数据加载完成
    }

    loadRoadbook(data, isImport = true) {
        // 清除现有数据
        this.clearAll();

        // 版本兼容性检查
        if (data.version) {
            console.log(`导入路书版本: ${data.version}`);
        }

        // 加载标记点
        data.markers.forEach(markerData => {
            console.log(`加载标记点: ID=${markerData.id}, 位置=${markerData.position}, 标题=${markerData.title}`);

            // 使用导入的图标信息或默认图标
            const iconConfig = markerData.icon || { type: 'default', icon: '📍', color: '#667eea' };
            const icon = this.createMarkerIcon(iconConfig, this.markers.length + 1);

            const marker = L.marker([markerData.position[0], markerData.position[1]], {
                icon: icon,
                draggable: true,
                title: markerData.title
            }).addTo(this.map);

            const markerObj = {
                id: markerData.id,
                marker: marker,
                position: markerData.position,
                title: markerData.title,
                labels: markerData.labels || [], // 导入labels数组
                icon: markerData.icon || { type: 'default', icon: '📍', color: '#667eea' }, // 导入图标信息
                createdAt: markerData.createdAt,
                dateTimes: markerData.dateTimes || [markerData.dateTime], // 导入多个时间点
                dateTime: markerData.dateTimes ? markerData.dateTimes[0] : markerData.dateTime // 兼容旧版本
            };

            this.markers.push(markerObj);

            // 添加事件监听
            marker.on('click', () => {
                this.showMarkerDetail(markerObj);
            });

            marker.on('contextmenu', (e) => {
                e.preventDefault(); // 防止默认右键菜单
                this.showMarkerContextMenu(markerObj);
            });

            marker.on('mouseover', (e) => {
                this.showMarkerTooltip(markerObj, e.latlng);
            });

            marker.on('mouseout', () => {
                this.hideMarkerTooltip();
            });

            marker.on('dragend', (e) => {
                const newPos = e.target.getLatLng();
                markerObj.position = [newPos.lat, newPos.lng];

                console.log(`导入拖拽事件触发 - 标记点ID: ${markerObj.id}, 新坐标: [${newPos.lat}, ${newPos.lng}]`);

                // 更新连接线
                this.updateConnections();

                // 更新标注位置
                this.updateLabels();

                // 如果当前标记点正在详情面板中显示，更新坐标显示
                if (this.currentMarker === markerObj) {
                    const markerCoords = document.getElementById('markerCoords');
                    if (markerCoords) {
                        markerCoords.textContent =
                            `${newPos.lng.toFixed(6)}, ${newPos.lat.toFixed(6)}`;
                    }
                }

                // 更新标记点列表中的坐标显示
                this.updateMarkerList();

                console.log(`导入的标记点"${markerObj.title}"坐标已更新: ${newPos.lat.toFixed(6)}, ${newPos.lng.toFixed(6)}`);

                // 保存到本地存储
                this.saveToLocalStorage();
                console.log(`导入标记点拖拽后本地存储已保存`);
            });
        });

        // 加载连接线
        data.connections.forEach(connData => {
            // 对于老版本的数据，使用startIndex和endIndex
            let startMarker, endMarker;
            if (connData.startIndex !== undefined && connData.endIndex !== undefined) {
                startMarker = this.markers[connData.startIndex];
                endMarker = this.markers[connData.endIndex];
            } else if (connData.startId !== undefined && connData.endId !== undefined) {
                // 对于新版本的数据，使用ID查找
                startMarker = this.markers.find(m => m.id === connData.startId);
                endMarker = this.markers.find(m => m.id === connData.endId);
            }

            if (!startMarker || !endMarker) {
                console.warn('无法找到连接的起始或结束标记点', connData);
                return;
            }

            // 创建连接线
            const polyline = L.polyline([
                [startMarker.position[0], startMarker.position[1]],
                [endMarker.position[0], endMarker.position[1]]
            ], {
                color: this.getTransportColor(connData.transportType),
                weight: 6,
                opacity: 1.0,
                smoothFactor: 1.0
            }).addTo(this.map);

            // 添加终点标记（小圆点）
            const endCircle = L.circleMarker([endMarker.position[0], endMarker.position[1]], {
                radius: 6,
                fillColor: this.getTransportColor(connData.transportType),
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 1
            }).addTo(this.map);

            // 创建箭头
            const arrowHead = this.createArrowHead(startMarker.position, endMarker.position, connData.transportType);
            arrowHead.addTo(this.map);

            // 计算中点位置并添加交通图标
            const startLat = parseFloat(startMarker.position[0]);
            const startLng = parseFloat(startMarker.position[1]);
            const endLat = parseFloat(endMarker.position[0]);
            const endLng = parseFloat(endMarker.position[1]);

            if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
                console.error('导入连接线坐标无效:', startMarker.position, endMarker.position);
                return;
            }

            const midLat = (startLat + endLat) / 2;
            const midLng = (startLng + endLng) / 2;
            const transportIcon = this.getTransportIcon(connData.transportType);

            const iconMarker = L.marker([midLat, midLng], {
                icon: L.divIcon({
                    className: 'transport-icon',
                    html: `<div style="background-color: white; border: 2px solid ${this.getTransportColor(connData.transportType)}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${transportIcon}</div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                })
            }).addTo(this.map);

            const connection = {
                id: connData.id,
                startId: startMarker.id, // 使用ID而不是对象引用
                endId: endMarker.id,     // 使用ID而不是对象引用
                transportType: connData.transportType,
                polyline: polyline,
                endCircle: endCircle,
                iconMarker: iconMarker,
                arrowHead: arrowHead,
                dateTime: connData.dateTime || this.getCurrentLocalDateTime(),
                label: connData.label || '',
                duration: connData.duration || 0, // 加载耗时信息
                startTitle: connData.startTitle || startMarker.title,
                endTitle: connData.endTitle || endMarker.title
            };

            // 添加连接线事件
            const self = this;
            polyline.on('click', function() {
                self.showConnectionDetail(connection);
            });

            polyline.on('mouseover', function(e) {
                self.showConnectionTooltip(connection, e.latlng);
            });

            polyline.on('mouseout', function() {
                self.hideConnectionTooltip();
            });

            this.connections.push(connection);
        });

        // 加载独立标注（兼容旧版本）
        if (data.labels) {
            data.labels.forEach(labelData => {
                const marker = this.markers[labelData.markerIndex];
                if (marker && labelData.content) {
                    this.createLabelForMarker(marker, labelData.content);
                }
            });
        }

        // 加载日期备注信息
        if (data.dateNotes) {
            this.dateNotes = data.dateNotes;
        } else {
            this.dateNotes = {};
        }

        this.updateMarkerList();

        const markerCount = this.markers.length;
        const connectionCount = this.connections.length;

        // 保存到本地存储
        this.saveToLocalStorage();

        // 只在手动导入文件时显示提示
        if (isImport) {
            alert(`路书导入成功！\n标记点: ${markerCount} 个\n连接线: ${connectionCount} 条`);
        }

        // 自动调整视窗以包含所有元素（取代定位到第一个标记点）
        this.autoFitMapView();
    }

    // 为标记点创建标注的辅助方法
    createLabelForMarker(marker, content) {
        const label = L.divIcon({
            className: 'custom-label',
            html: `<div style="background-color: rgba(255,255,255,0.9); border: 2px solid #667eea; border-radius: 5px; padding: 8px; font-size: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 200px;">${content}</div>`,
            iconSize: [200, 'auto'],
            iconAnchor: [100, -10]
        });

        const labelMarker = L.marker([marker.position[0], marker.position[1]], {
            icon: label
        }).addTo(this.map);

        marker.labels.push(labelMarker);
        this.labels.push({ marker: marker, label: labelMarker, content: content });
    }

    // 自动调整地图视窗以包含所有元素
    autoFitMapView() {
        if (this.markers.length === 0 && this.connections.length === 0) {
            console.log('没有标记点和连接线，保持默认视窗');
            return;
        }

        console.log('开始自动调整地图视窗，标记点数量:', this.markers.length, '连接线数量:', this.connections.length);

        try {
            // 创建边界对象
            const bounds = L.latLngBounds();
            let hasValidPoints = false;

            // 添加所有标记点的坐标到边界
            this.markers.forEach(marker => {
                if (marker.position && marker.position.length >= 2) {
                    const lat = parseFloat(marker.position[0]);
                    const lng = parseFloat(marker.position[1]);
                    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                        bounds.extend([lat, lng]);
                        hasValidPoints = true;
                        console.log(`添加标记点到边界: [${lat}, ${lng}]`);
                    } else {
                        console.warn(`无效的标记点坐标: [${lat}, ${lng}]`);
                    }
                }
            });

            // 添加所有连接线的坐标到边界
            this.connections.forEach(connection => {
                if (connection.polyline) {
                    try {
                        const latlngs = connection.polyline.getLatLngs();
                        if (Array.isArray(latlngs) && latlngs.length > 0) {
                            latlngs.forEach(latlng => {
                                if (latlng && typeof latlng.lat === 'number' && typeof latlng.lng === 'number') {
                                    const lat = parseFloat(latlng.lat);
                                    const lng = parseFloat(latlng.lng);
                                    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                                        bounds.extend([lat, lng]);
                                        hasValidPoints = true;
                                        console.log(`添加连接线点到边界: [${lat}, ${lng}]`);
                                    }
                                }
                            });
                        }
                    } catch (err) {
                        console.warn('获取连接线坐标失败:', err);
                    }
                }
            });

            // 检查是否有有效的点
            if (!hasValidPoints) {
                console.warn('没有找到有效的坐标点');
                return;
            }

            // 检查边界是否有效
            if (bounds.isValid()) {
                // 计算合适的padding，根据标记点数量调整
                const markerCount = this.markers.length + this.connections.length;
                const basePadding = 50;
                const additionalPadding = Math.min(markerCount * 10, 100); // 最多额外增加100像素
                const padding = basePadding + additionalPadding;

                console.log(`调整地图视窗到边界，使用padding: ${padding}px`);

                // 获取边界的中心点和建议缩放级别
                const center = bounds.getCenter();
                const zoom = this.map.getBoundsZoom(bounds, false, [padding, padding]);

                console.log(`边界中心点: [${center.lat}, ${center.lng}], 建议缩放级别: ${zoom}`);

                // 延迟执行以确保所有元素都已渲染
                setTimeout(() => {
                    try {
                        this.map.fitBounds(bounds, {
                            padding: [padding, padding],
                            maxZoom: 16, // 最大缩放级别，避免过度放大
                            minZoom: 3,  // 最小缩放级别，避免缩放过小
                            animate: true,
                            duration: 1.5, // 动画持续时间1.5秒
                            easeLinearity: 0.25
                        });

                        console.log('地图视窗调整完成');
                    } catch (err) {
                        console.error('调整视窗时出错:', err);
                    }
                }, 400); // 400毫秒延迟，确保DOM完全更新

            } else {
                console.warn('边界无效，无法调整视窗');
            }

        } catch (error) {
            console.error('自动调整视窗时出错:', error);
        }
    }

    // 筛选后自动调整地图视窗以包含筛选后的元素
    autoFitMapViewAfterFilter() {
        if (!this.filterMode || !this.filteredDate) {
            console.log('不在筛选模式，使用常规自动调整视窗');
            this.autoFitMapView();
            return;
        }

        console.log('筛选模式下自动调整地图视窗，日期:', this.filteredDate);

        try {
            // 创建边界对象
            const bounds = L.latLngBounds();
            let hasValidPoints = false;

            // 添加筛选日期内的标记点坐标到边界
            this.markers.forEach(marker => {
                const markerDates = this.getMarkerAllDates(marker);
                if (markerDates.includes(this.filteredDate)) {
                    if (marker.position && marker.position.length >= 2) {
                        const lat = parseFloat(marker.position[0]);
                        const lng = parseFloat(marker.position[1]);
                        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                            bounds.extend([lat, lng]);
                            hasValidPoints = true;
                            console.log(`添加筛选后标记点到边界: [${lat}, ${lng}]`);
                        } else {
                            console.warn(`无效的筛选后标记点坐标: [${lat}, ${lng}]`);
                        }
                    }
                }
            });

            // 添加筛选日期内的连接线坐标到边界
            this.connections.forEach(connection => {
                const connectionDate = this.getDateKey(connection.dateTime);
                if (connectionDate === this.filteredDate && connection.polyline) {
                    try {
                        const latlngs = connection.polyline.getLatLngs();
                        if (Array.isArray(latlngs) && latlngs.length > 0) {
                            latlngs.forEach(latlng => {
                                if (latlng && typeof latlng.lat === 'number' && typeof latlng.lng === 'number') {
                                    const lat = parseFloat(latlng.lat);
                                    const lng = parseFloat(latlng.lng);
                                    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                                        bounds.extend([lat, lng]);
                                        hasValidPoints = true;
                                        console.log(`添加筛选后连接线点到边界: [${lat}, ${lng}]`);
                                    }
                                }
                            });
                        }
                    } catch (err) {
                        console.warn('获取筛选后连接线坐标失败:', err);
                    }
                }
            });

            // 检查是否有有效的点
            if (!hasValidPoints) {
                console.warn('筛选后没有找到有效的坐标点');

                // 如果筛选后没有点，可以保持当前视图或提供提示
                return;
            }

            // 检查边界是否有效
            if (bounds.isValid()) {
                // 计算合适的padding
                const basePadding = 50;

                console.log(`筛选后调整地图视窗到边界，使用padding: ${basePadding}px`);

                // 延迟执行以确保所有元素都已渲染
                setTimeout(() => {
                    try {
                        this.map.fitBounds(bounds, {
                            padding: [basePadding, basePadding],
                            maxZoom: 16, // 最大缩放级别，避免过度放大
                            minZoom: 3,  // 最小缩放级别，避免缩放过小
                            animate: true,
                            duration: 1.5, // 动画持续时间1.5秒
                            easeLinearity: 0.25
                        });

                        console.log('筛选后地图视窗调整完成');
                    } catch (err) {
                        console.error('筛选后调整视窗时出错:', err);
                    }
                }, 400); // 400毫秒延迟，确保DOM完全更新

            } else {
                console.warn('筛选后边界无效，无法调整视窗');
            }

        } catch (error) {
            console.error('筛选后自动调整视窗时出错:', error);
        }
    }

    clearAll() {
        // 清除所有标记点
        this.markers.forEach(marker => {
            marker.marker.remove();
            // 标注不再直接显示，无需删除
        });

        // 清除所有连接线
        this.connections.forEach(conn => {
            conn.polyline.remove();
            if (conn.endCircle) {
                conn.endCircle.remove();
            }
            if (conn.iconMarker) {
                conn.iconMarker.remove();
            }
            if (conn.arrowHead) {
                conn.arrowHead.remove();
            }
        });

        this.markers = [];
        this.connections = [];
        this.labels = [];
        this.dateNotes = {}; // 清除日期备注
        this.updateMarkerList();
    }

    showMarkerContextMenu(markerData) {
        // 简单的右键菜单
        if (confirm(`要删除标记点"${markerData.title}"吗？`)) {
            this.removeMarker(markerData);
        }
    }

    removeConnection(connection) {
        if (!connection) return;

        // 记录删除连接操作到历史栈
        this.addHistory('removeConnection', {
            id: connection.id,
            startId: connection.startId,
            endId: connection.endId,
            transportType: connection.transportType,
            dateTime: connection.dateTime,
            label: connection.label,
            duration: connection.duration,
            startTitle: connection.startTitle,
            endTitle: connection.endTitle
        });

        // 从地图上移除
        connection.polyline.remove();
        if (connection.endCircle) {
            connection.endCircle.remove();
        }
        if (connection.iconMarker) {
            connection.iconMarker.remove();
        }
        if (connection.arrowHead) {
            connection.arrowHead.remove();
        }

        // 从数组中移除
        this.connections = this.connections.filter(conn => conn !== connection);

        // 保存到本地存储
        this.saveToLocalStorage();
    }

    removeMarker(markerData) {
        // 记录删除操作到历史栈
        this.addHistory('removeMarker', {
            id: markerData.id,
            position: [...markerData.position],
            title: markerData.title,
            labels: [...markerData.labels], // 复制数组
            icon: {...markerData.icon}, // 复制对象
            createdAt: markerData.createdAt,
            dateTimes: [...markerData.dateTimes],
            dateTime: markerData.dateTime
        });

        // 删除标记点
        markerData.marker.remove();
        // 标注不再直接显示，无需删除

        // 删除相关连接 - 使用ID进行匹配，而不是对象引用
        this.connections = this.connections.filter(conn => {
            if (conn.startId === markerData.id || conn.endId === markerData.id) {
                conn.polyline.remove();
                if (conn.endCircle) {
                    conn.endCircle.remove();
                }
                if (conn.iconMarker) {
                    conn.iconMarker.remove();
                }
                if (conn.arrowHead) {
                    conn.arrowHead.remove();
                }
                return false;
            }
            return true;
        });

        // 从数组中移除
        this.markers = this.markers.filter(m => m !== markerData);
        this.labels = this.labels.filter(l => l.marker !== markerData);

        this.updateMarkerList();

        // 保存到本地存储
        this.saveToLocalStorage();
    }

    // 检查并处理筛选模式 - 如果处于筛选模式则退出但保持当前视图
    checkAndHandleFilterMode() {
        if (this.filterMode) {
            // 如果日期详情面板是打开的，手动保存内容并关闭面板（防止递归调用）
            const dateNotesInput = document.getElementById('dateNotesInput');
            if (dateNotesInput && this.currentDate) {
                // 手动保存备注内容
                if (!this.dateNotes) {
                    this.dateNotes = {};
                }
                const notes = dateNotesInput.value.trim();
                this.dateNotes[this.currentDate] = notes;

                // 保存到本地存储
                this.saveToLocalStorage();

                // 隐藏日期详情面板
                const dateDetailPanel = document.getElementById('dateDetailPanel');
                if (dateDetailPanel) {
                    dateDetailPanel.style.display = 'none';
                }

                // 清除当前状态
                this.currentDate = null;
                this.currentMarker = null;
                this.currentConnection = null;
            }

            // 退出筛选模式但不调整视图
            this.exitFilterMode(false);
        }
    }

    showMarkerDetail(markerData) {
        // 如果当前处于筛选模式，则退出筛选模式但保持当前视图
        this.checkAndHandleFilterMode();

        this.currentMarker = markerData;
        this.currentConnection = null;

        // 设置面板标题
        const detailTitle = document.getElementById('detailTitle');
        if (detailTitle) {
            detailTitle.textContent = '标记点详情';
        }

        // 填充详情面板数据
        const markerNameInput = document.getElementById('markerNameInput');
        if (markerNameInput) {
            markerNameInput.value = markerData.title;
            markerNameInput.style.display = 'block';
        }

        // 显示时间点列表（新的多点时间管理）
        this.updateDateTimesDisplay();

        const markerCoords = document.getElementById('markerCoords');
        if (markerCoords) {
            markerCoords.textContent =
                `${markerData.position[1].toFixed(6)}, ${markerData.position[0].toFixed(6)}`;
        }

        // 显示标注内容 - 现在labels是字符串数组
        const labelsContent = markerData.labels.join('; ');
        const markerLabelsInput = document.getElementById('markerLabelsInput');
        if (markerLabelsInput) {
            markerLabelsInput.value = labelsContent || '';
            markerLabelsInput.style.display = 'block';
        }

        // 显示当前图标
        this.updateCurrentIconPreview(markerData.icon);

        // 隐藏连接线详情面板，显示标记点详情面板
        const connectionDetailPanel = document.getElementById('connectionDetailPanel');
        if (connectionDetailPanel) {
            connectionDetailPanel.style.display = 'none';
        }
        const markerDetailPanel = document.getElementById('markerDetailPanel');
        if (markerDetailPanel) {
            markerDetailPanel.style.display = 'block';
        }
    }

    hideMarkerDetail() {
        const markerDetailPanel = document.getElementById('markerDetailPanel');
        if (markerDetailPanel) {
            markerDetailPanel.style.display = 'none';
        }
        this.currentMarker = null;
        this.currentConnection = null;
    }

    // 更新时间点显示
    updateDateTimesDisplay() {
        const container = document.getElementById('dateTimesContainer');
        if (!container || !this.currentMarker) return;

        container.innerHTML = '';

        const dateTimes = this.currentMarker.dateTimes || [this.currentMarker.dateTime];

        dateTimes.forEach((dateTime, index) => {
            const timeItem = document.createElement('div');
            timeItem.className = 'date-time-item';

            const timeInput = document.createElement('input');
            timeInput.type = 'datetime-local';
            timeInput.value = this.getLocalDateTimeForInput(dateTime);
            timeInput.addEventListener('change', (e) => {
                this.updateMarkerDateTime(index, e.target.value);
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-time-btn';
            deleteBtn.textContent = '删除';
            deleteBtn.addEventListener('click', () => {
                this.deleteMarkerDateTime(index);
            });

            timeItem.appendChild(timeInput);
            if (dateTimes.length > 1) {
                timeItem.appendChild(deleteBtn);
            }

            container.appendChild(timeItem);
        });
    }

    // 更新标记点时间
    updateMarkerDateTime(index, newDateTime) {
        if (!this.currentMarker || !this.currentMarker.dateTimes) return;

        this.currentMarker.dateTimes[index] = newDateTime;
        this.currentMarker.dateTime = this.currentMarker.dateTimes[0]; // 更新主时间

        // 更新显示
        this.updateDateTimesDisplay();
        this.updateMarkerList();

        // 保存到本地存储
        this.saveToLocalStorage();

        console.log(`标记点"${this.currentMarker.title}"时间点${index + 1}已更新: ${newDateTime}`);
    }

    // 删除标记点时间
    deleteMarkerDateTime(index) {
        if (!this.currentMarker || !this.currentMarker.dateTimes || this.currentMarker.dateTimes.length <= 1) {
            alert('至少需要保留一个时间点！');
            return;
        }

        if (confirm('确定要删除这个时间点吗？')) {
            this.currentMarker.dateTimes.splice(index, 1);
            this.currentMarker.dateTime = this.currentMarker.dateTimes[0]; // 更新主时间

            // 更新显示
            this.updateDateTimesDisplay();
            this.updateMarkerList();

            // 保存到本地存储
            this.saveToLocalStorage();

            console.log(`标记点"${this.currentMarker.title}"时间点已删除，剩余${this.currentMarker.dateTimes.length}个时间点`);
        }
    }

    // 添加新的时间点
    addMarkerDateTime() {
        if (!this.currentMarker) return;

        if (!this.currentMarker.dateTimes) {
            this.currentMarker.dateTimes = [this.currentMarker.dateTime];
        }

        // 获取最后一个时间点，如果没有则使用当前时间
        let lastDateTime = null;
        if (this.currentMarker.dateTimes.length > 0) {
            // 获取最后一个时间点
            lastDateTime = new Date(this.currentMarker.dateTimes[this.currentMarker.dateTimes.length - 1]);
        } else if (this.currentMarker.dateTime) {
            lastDateTime = new Date(this.currentMarker.dateTime);
        }

        let newDateTime;
        if (lastDateTime) {
            // 将时间加一天，并将时分秒设置为00:00:00
            lastDateTime.setDate(lastDateTime.getDate() + 1); // 加一天
            lastDateTime.setHours(0, 0, 0, 0); // 设置为00:00:00
            newDateTime = `${lastDateTime.getFullYear()}-${String(lastDateTime.getMonth() + 1).padStart(2, '0')}-${String(lastDateTime.getDate()).padStart(2, '0')} 00:00:00`;
        } else {
            // 如果没有上一个时间点，使用当前时间
            newDateTime = this.getCurrentLocalDateTime();
        }

        this.currentMarker.dateTimes.push(newDateTime);

        // 更新显示
        this.updateDateTimesDisplay();
        this.updateMarkerList();

        // 保存到本地存储
        this.saveToLocalStorage();

        console.log(`标记点"${this.currentMarker.title}"添加新时间点: ${newDateTime}`);
    }

    hideConnectionDetail() {
        const connectionDetailPanel = document.getElementById('connectionDetailPanel');
        if (connectionDetailPanel) {
            connectionDetailPanel.style.display = 'none';
        }
        this.currentMarker = null;
        this.currentConnection = null;
    }

    updateConnectionTransport(connection, transportType) {
        if (!connection) return;

        // 更新连接线的交通方式
        connection.transportType = transportType;

        // 更新地图上的连接线
        this.updateConnectionVisual(connection);

        console.log(`连接线交通方式已更新: ${transportType}`);
    }

    updateConnectionVisual(connection) {
        if (!connection || !connection.polyline) return;

        // 通过ID获取当前的起始点和终点对象
        const startMarker = this.markers.find(m => m.id === connection.startId);
        const endMarker = this.markers.find(m => m.id === connection.endId);

        if (!startMarker || !endMarker) {
            console.error('连接线的起始点或终点不存在:', connection.startId, connection.endId);
            return;
        }

        // 更新连接线的坐标
        const startLat = parseFloat(startMarker.position[0]);
        const startLng = parseFloat(startMarker.position[1]);
        const endLat = parseFloat(endMarker.position[0]);
        const endLng = parseFloat(endMarker.position[1]);

        if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
            console.error('连接线坐标无效:', startMarker.position, endMarker.position);
            return;
        }

        // 更新连接线坐标
        const newPath = [
            [startLat, startLng],
            [endLat, endLng]
        ];
        connection.polyline.setLatLngs(newPath);

        // 更新终点圆点位置
        if (connection.endCircle) {
            connection.endCircle.setLatLng([endLat, endLng]);
        }

        // 更新图标位置（中点）
        if (connection.iconMarker) {
            const midLat = (startLat + endLat) / 2;
            const midLng = (startLng + endLng) / 2;
            connection.iconMarker.setLatLng([midLat, midLng]);
        }

        // 更新箭头
        if (connection.arrowHead) {
            const newArrow = this.createArrowHead(startMarker.position, endMarker.position, connection.transportType);
            connection.arrowHead.remove();
            connection.arrowHead = newArrow;
            connection.arrowHead.addTo(this.map);
        }

        // 更新线的颜色样式
        const color = this.getTransportColor(connection.transportType);
        connection.polyline.setStyle({
            color: color,
            weight: 6,
            opacity: 1.0
        });

        // 更新终点圆点颜色
        if (connection.endCircle) {
            connection.endCircle.setStyle({
                fillColor: color
            });
        }

        // 更新图标
        if (connection.iconMarker) {
            const icon = this.getTransportIcon(connection.transportType);
            connection.iconMarker.setIcon(L.divIcon({
                html: `<div style="background-color: white; border: 2px solid ${color}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${icon}</div>`,
                className: 'transport-icon',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            }));
        }

        // 更新详情面板中的显示
        if (this.currentConnection === connection) {
            const markerCoords = document.getElementById('markerCoords');
            if (markerCoords) {
                markerCoords.textContent = `${startMarker.title} → ${endMarker.title} (${this.getTransportIcon(connection.transportType)} ${this.getTransportTypeName(connection.transportType)})`;
            }
        }
    }

    saveConnectionDetail() {
        if (!this.currentConnection) return;

        // 保存连接线详情
        const dateTimeInput = document.getElementById('connectionDateInput');
        if (dateTimeInput && dateTimeInput.value) {
            this.currentConnection.dateTime = dateTimeInput.value;
        }

        // 获取当前选中的交通方式
        const activeTransportBtn = document.querySelector('.transport-btn.active');
        if (activeTransportBtn) {
            this.currentConnection.transportType = activeTransportBtn.dataset.transport;
        }

        // 保存标注内容
        const labelsInput = document.getElementById('connectionLabelsInput');
        if (labelsInput) {
            this.currentConnection.label = labelsInput.value.trim();
        }

        // 保存耗时信息
        const durationInput = document.getElementById('connectionDuration');
        if (durationInput && durationInput.value !== '') {
            this.currentConnection.duration = parseInt(durationInput.value) || 0;
        }

        // 检查起始点和终点是否被更改
        const startSelect = document.getElementById('connectionStartMarker');
        const endSelect = document.getElementById('connectionEndMarker');

        if (startSelect && endSelect) {
            const newStartIndex = parseInt(startSelect.value);
            const newEndIndex = parseInt(endSelect.value);

            const newStartMarker = this.markers[newStartIndex];
            const newEndMarker = this.markers[newEndIndex];

            // 如果起始点或终点被更改
            const oldStartMarker = this.markers.find(m => m.id === this.currentConnection.startId);
            const oldEndMarker = this.markers.find(m => m.id === this.currentConnection.endId);

            if ((oldStartMarker && oldStartMarker.id !== newStartMarker.id) ||
                (oldEndMarker && oldEndMarker.id !== newEndMarker.id)) {

                // 保存旧的起始点和终点信息，用于显示
                const oldStartTitle = oldStartMarker ? oldStartMarker.title : this.currentConnection.startTitle;
                const oldEndTitle = oldEndMarker ? oldEndMarker.title : this.currentConnection.endTitle;

                // 更新连接线的起始点和终点ID
                this.currentConnection.startId = newStartMarker.id;
                this.currentConnection.endId = newEndMarker.id;
                this.currentConnection.startTitle = newStartMarker.title;
                this.currentConnection.endTitle = newEndMarker.title;

                // 更新连接线在地图上的显示
                this.updateConnectionVisual(this.currentConnection);

                console.log(`连接线更新: ${oldStartTitle} → ${oldEndTitle} 改为 ${newStartMarker.title} → ${newEndMarker.title}`);
            }
        }

        // 更新地图上的连接线显示
        this.updateConnectionVisual(this.currentConnection);

        // 更新连接线列表
        this.updateMarkerList();

        console.log('连接线详情已保存:', this.currentConnection);

        // 关闭详情面板
        this.hideConnectionDetail();

        // 保存到本地存储（移除成功提示）
        this.saveToLocalStorage();
    }

    saveMarkerDetail() {
        if (this.currentMarker) {
            // 保存标记点
            const newName = document.getElementById('markerNameInput').value.trim();
            if (newName) {
                this.currentMarker.title = newName;
                this.currentMarker.marker.setTooltipContent(newName);
            }

            // 保存标注内容 - 只保存文本，不直接显示
            const labelsText = document.getElementById('markerLabelsInput').value.trim();
            if (labelsText) {
                this.currentMarker.labels = labelsText.split(';').map(label => label.trim()).filter(label => label);
            } else {
                this.currentMarker.labels = [];
            }

            this.updateMarkerList();
        } else if (this.currentConnection) {
            // 保存连接线
            const dateTimeValue = document.getElementById('connectionDateInput').value;
            if (dateTimeValue) {
                this.currentConnection.dateTime = dateTimeValue;
            }

            // 保存耗时
            const durationValue = document.getElementById('connectionDuration').value;
            if (durationValue) {
                this.currentConnection.duration = parseFloat(durationValue);
            }

            // 保存标注内容
            const connectionLabelsInput = document.getElementById('connectionLabelsInput');
            if (connectionLabelsInput) {
                const labelText = connectionLabelsInput.value.trim();
                this.currentConnection.label = labelText;
            }
        }

        this.hideMarkerDetail();

        // 保存到本地存储
        this.saveToLocalStorage();
    }

    deleteCurrentMarker() {
        if (!this.currentMarker) return;

        if (confirm(`确定要删除标记点"${this.currentMarker.title}"吗？`)) {
            this.removeMarker(this.currentMarker);
            this.hideMarkerDetail();
        }
    }

    deleteCurrentConnection() {
        if (!this.currentConnection) return;

        if (confirm(`确定要删除连接线"${this.currentConnection.startTitle} → ${this.currentConnection.endTitle}"吗？`)) {
            this.removeConnection(this.currentConnection);
            this.hideConnectionDetail();
        }
    }

    showHelpModal() {
        document.getElementById('helpModal').style.display = 'block';
    }

    closeHelpModal() {
        document.getElementById('helpModal').style.display = 'none';
    }

    // 删除当前选中的元素（标记点或连接线）
    deleteCurrentElement() {
        if (this.currentMarker) {
            // 如果当前选中的是标记点，执行删除标记点操作
            this.deleteCurrentMarker();
        } else if (this.currentConnection) {
            // 如果当前选中的是连接线，执行删除连接线操作
            this.deleteCurrentConnection();
        }
        // 如果都没有选中，不执行任何操作
    }

    // 显示日期详情
    showDateDetail(date) {
        this.currentDate = date;
        this.currentMarker = null;
        this.currentConnection = null;

        // 设置面板标题
        const dateDetailTitle = document.getElementById('dateDetailTitle');
        if (dateDetailTitle) {
            dateDetailTitle.textContent = `${this.formatDateHeader(date)} 详情`;
        }

        // 显示日期
        const dateDisplay = document.getElementById('dateDisplay');
        if (dateDisplay) {
            dateDisplay.textContent = date;
        }

        // 显示日期备注
        const dateNotesInput = document.getElementById('dateNotesInput');
        if (dateNotesInput) {
            // 如果存在日期备注，显示它；否则显示空字符串
            dateNotesInput.value = this.getDateNotes(date) || '';
        }

        // 隐藏其他详情面板，显示日期详情面板
        const markerDetailPanel = document.getElementById('markerDetailPanel');
        const connectionDetailPanel = document.getElementById('connectionDetailPanel');
        const dateDetailPanel = document.getElementById('dateDetailPanel');

        if (markerDetailPanel) markerDetailPanel.style.display = 'none';
        if (connectionDetailPanel) connectionDetailPanel.style.display = 'none';
        if (dateDetailPanel) dateDetailPanel.style.display = 'block';
    }

    // 获取指定日期的备注
    getDateNotes(date) {
        if (!this.dateNotes) {
            this.dateNotes = {};
        }
        return this.dateNotes[date] || '';
    }


    // 保存日期备注
    saveDateNotes() {
        const dateNotesInput = document.getElementById('dateNotesInput');
        if (!dateNotesInput || !this.currentDate) return;

        if (!this.dateNotes) {
            this.dateNotes = {};
        }

        const notes = dateNotesInput.value.trim();
        this.dateNotes[this.currentDate] = notes;

        // 保存到本地存储
        this.saveToLocalStorage();

        console.log(`日期 ${this.currentDate} 的备注已保存`);

        // 隐藏日期详情面板（自动退出编辑页面）
        const dateDetailPanel = document.getElementById('dateDetailPanel');
        if (dateDetailPanel) {
            dateDetailPanel.style.display = 'none';
        }

        // 清除当前日期状态
        this.currentDate = null;
        this.currentMarker = null;
        this.currentConnection = null;

        // 如果当前处于筛选模式，则退出筛选模式
        if (this.filterMode) {
            this.exitFilterMode();
        }
    }

    closeDateDetail() {
        const dateDetailPanel = document.getElementById('dateDetailPanel');
        if (dateDetailPanel) {
            dateDetailPanel.style.display = 'none';
        }
        this.currentDate = null;
        this.currentMarker = null;
        this.currentConnection = null;

        // 如果当前处于筛选模式，则退出筛选模式
        if (this.filterMode) {
            this.exitFilterMode();
        }
    }

    closeModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
        // 不再调用 closeDateDetail，因为关闭模态框不应该影响当前选中的标记点或连接
    }

}

// 初始化应用
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new RoadbookApp();
    window.app = app; // 使应用实例全局可访问
});
