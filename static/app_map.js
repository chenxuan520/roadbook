// app_map.js - 地图与标记连接核心方法

RoadbookApp.prototype.initMap = function() {
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
            searchable: true,
            name: 'ESRI影像图',
            searchUrl: apiBaseUrl + '/api/tianmap/search',
            params: {format: 'json', limit: 10},
            parser: 'nominatim'
        },
        esri_street: {
            searchable: true,
            name: 'ESRI街道图',
            searchUrl: apiBaseUrl + '/api/tianmap/search',
            params: {format: 'json', limit: 10},
            parser: 'nominatim'
        },
        gaode: {
            searchable: true,
            name: '高德地图',
            searchUrl: apiBaseUrl + '/api/tianmap/search', // 使用TianSearch端点
            params: {
                format: 'json',
                limit: 10
            },
            parser: 'nominatim' // 使用Nominatim格式，因为TianSearch与Nominatim格式一致
        },
        gaode_satellite: {
            searchable: true,
            name: '高德卫星图',
            searchUrl: apiBaseUrl + '/api/tianmap/search',
            params: {format: 'json', limit: 10},
            parser: 'nominatim'
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
            searchable: true,
            name: 'Google卫星图',
            searchUrl: apiBaseUrl + '/api/tianmap/search',
            params: {format: 'json', limit: 10},
            parser: 'nominatim'
        },
        tencent: {
            searchable: true,
            name: '腾讯地图',
            searchUrl: apiBaseUrl + '/api/tianmap/search',
            params: {format: 'json', limit: 10},
            parser: 'nominatim'
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
        esri_street: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri',
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
        }),
        tencent: L.tileLayer('https://rt{s}.map.gtimg.com/realtimerender?z={z}&x={x}&y={-y}&type=vector&styleid=3', {
            attribution: '&copy; Tencent',
            maxZoom: 18,
            subdomains: ['0', '1', '2']
        })
    };

    // 验证当前图层是否存在，如果不存在则回退到默认值
    if (!this.mapLayers[this.currentLayer]) {
        console.warn(`缓存的地图源 "${this.currentLayer}" 已失效，自动切换到默认地图。`);
        this.currentLayer = 'gaode'; // 默认高德地图
        this.saveToLocalStorage(); // 更新缓存，防止下次再出错
    }

    // 添加当前图层到地图
    // this.currentLayer 已经在 init() 方法中设置好了
    this.mapLayers[this.currentLayer].addTo(this.map);

    // 添加比例尺控件
    L.control.scale({imperial: false, metric: true}).addTo(this.map);

    // 添加地图点击事件
    this.map.on('click', (e) => {
        if (this.isMobileDevice()) return; // 移动端禁止点击地图操作

        // 新增: 如果AI助手窗口是打开的，则关闭它
        if (window.aiAssistant && typeof window.aiAssistant.closeChatIfOpen === 'function') {
            window.aiAssistant.closeChatIfOpen();
        }

        if (this.currentMode === 'addMarker') {
            this.addMarker(e.latlng);
        } else {
            // 如果当前处于编辑模式（有选中的标记点或连接线），则退出编辑模式
            // 这模仿了日期编辑界面的行为：点击地图返回列表，但不调整视图
            if (this.currentMarker) {
                this.hideMarkerDetail();
            }
            if (this.currentConnection) {
                this.hideConnectionDetail();
            }
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
        // 添加安全校验，防止事件对象不规范导致报错
        if (e && typeof e.preventDefault === 'function') {
            e.preventDefault(); // 阻止浏览器默认右键菜单
        }
    });
};

RoadbookApp.prototype.updateRecommendedTransportInModal = function() {
    const startSelect = document.getElementById('startMarker');
    const endSelect = document.getElementById('endMarker');
    const transportTypeSelect = document.getElementById('transportType');

    if (startSelect.value && endSelect.value) {
        const startMarker = this.markers[startSelect.value];
        const endMarker = this.markers[endSelect.value];
        if (startMarker && endMarker) {
            const distance = startMarker.marker.getLatLng().distanceTo(endMarker.marker.getLatLng());
            const recommendedTransport = this.getRecommendedTransport(distance);

            document.querySelectorAll('#connectModal .transport-btn').forEach(b => b.classList.remove('active'));
            const recommendedBtn = document.querySelector(`#connectModal .transport-btn[data-transport="${recommendedTransport}"]`);
            if (recommendedBtn) {
                recommendedBtn.classList.add('active');
            }
            if (transportTypeSelect) {
                transportTypeSelect.value = recommendedTransport;
            }
        }
    }
};

RoadbookApp.prototype.switchMapSource = function(newSource) {
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
};

RoadbookApp.prototype.createMarkerEntity = function(lat, lng, title = null, id = null, customIconConfig = null, dateTime = null) {
    const markerId = id || Date.now();
    const markerTitle = title || `标记点${this.markers.length + 1}`;
    const iconConfig = customIconConfig || this.getIconForName(markerTitle);
    const icon = this.createMarkerIcon(iconConfig, this.markers.length + 1);

    const marker = L.marker([lat, lng], {
        icon: icon,
        draggable: !this.isMobileDevice(),
        title: markerTitle
    }).addTo(this.map);

    let newMarkerDateTimes = [];
    let newMarkerDateTime = null;

    // Handle dateTime input (can be string, array, or null)
    if (Array.isArray(dateTime) && dateTime.length > 0) {
        newMarkerDateTimes = [...dateTime]; // Copy array
        newMarkerDateTime = dateTime[0];
    } else if (typeof dateTime === 'string') {
        newMarkerDateTimes = [dateTime];
        newMarkerDateTime = dateTime;
    }

    // If no valid time provided, generate default
    if (!newMarkerDateTime) {
        // 确定新标记点的时间 - 如果有上一个点则使用其时间，否则为当天00:00
        newMarkerDateTime = this.getCurrentLocalDateTime();
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
        // Sync array with default
        newMarkerDateTimes = [newMarkerDateTime];
    } else if (newMarkerDateTimes.length === 0) {
        // If input was empty array, sync with the (potentially fallback) single time
        newMarkerDateTimes = [newMarkerDateTime];
    }

    const markerData = {
        id: markerId, // 不可见不可编辑的唯一ID
        marker: marker,
        position: [lat, lng],
        title: markerTitle,
        labels: [], // 存储标注文本，不直接显示
        logo: null, // 添加logo属性，默认为空
        icon: iconConfig, // 保存图标信息
        createdAt: this.getCurrentLocalDateTime(),
        dateTimes: newMarkerDateTimes, // 改为数组，支持多个时间点
        dateTime: newMarkerDateTime // 使用第一个时间点作为默认时间
    };

    // 添加点击事件显示详情
    marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (this.isMobileDevice()) {
            const popupContent = this.generateMarkerPopupContent(markerData, { withDelete: true });
            marker.bindPopup(popupContent).openPopup();
        } else {
            this.showMarkerDetail(markerData);
        }
    });

    // 移动端：标记气泡内提供删除入口（极轻量编辑）
    marker.on('popupopen', () => {
        const popup = marker.getPopup();
        const popupEl = popup && popup.getElement();
        if (!popupEl) return;
        const delBtn = popupEl.querySelector('.popup-delete-marker');
        if (!delBtn) return;
        delBtn.onclick = async () => {
            const result = await this.showSwalConfirm('删除确认', `确定要删除标记点"${markerData.title}"吗？`, '删除', '取消');
            if (result.isConfirmed) {
                marker.closePopup();
                this.removeMarker(markerData);
            }
        };
    });

    // 添加悬浮事件显示标注信息
    marker.on('mouseover', (e) => {
        if (e.target.getElement()) {
            e.target.getElement()._savedTitle = e.target.getElement().getAttribute('title');
            e.target.getElement().removeAttribute('title');
        }
        this.showMarkerTooltip(markerData, e.latlng, e);
    });

    marker.on('mouseout', (e) => {
        if (e.target.getElement() && e.target.getElement()._savedTitle) {
            e.target.getElement().setAttribute('title', e.target.getElement()._savedTitle);
        }
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

    return markerData;
};

RoadbookApp.prototype.addMarker = function(latlng) {
    // 从搜索框获取名称,如果为空则使用默认名称
    const searchInput = document.getElementById('searchInput');
    const markerTitle = searchInput.value.trim() ? searchInput.value.trim() : null;

    const markerData = this.createMarkerEntity(latlng.lat, latlng.lng, markerTitle);

    this.markers.push(markerData);
    this.updateMarkerList();
    this.setMode('view');

    // 记录添加操作到历史栈
    this.addHistory('addMarker', {
        id: markerData.id,
        position: markerData.position,
        title: markerData.title,
        icon: markerData.icon,
        createdAt: markerData.createdAt,
        dateTimes: markerData.dateTimes,
        dateTime: markerData.dateTime
    });

    // 保存到本地存储
    this.saveToLocalStorage();

    // 自动显示新添加标记点的详情面板
    this.showMarkerDetail(markerData);
};

RoadbookApp.prototype.showIconModal = function() {
    const iconModal = document.getElementById('iconModal');
    if (iconModal) iconModal.style.display = 'block';
    // 重置选择状态（限定在弹窗内，避免误伤其它区域同类元素）
    if (iconModal) {
        iconModal.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
    }
    document.getElementById('customIcon').value = '';
    document.getElementById('iconColor').value = '#667eea';
};

RoadbookApp.prototype.updateCurrentIconPreview = function(iconConfig) {
    const preview = document.getElementById('currentIconPreview');
    if (preview && iconConfig) {
        preview.textContent = iconConfig.icon || '📍';
        preview.style.backgroundColor = iconConfig.color || '#667eea';
    }
};

RoadbookApp.prototype.confirmIconSelection = function() {
    const iconModal = document.getElementById('iconModal');
    const selectedOption = iconModal ? iconModal.querySelector('.icon-option.selected') : null;
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

        this.debugLog(`标记点"${this.currentMarker.title}"图标已更新:`, newIconConfig);
    } else {
        // 如果没有当前标记点，设置为默认图标（用于新标记点）
        this.currentIcon = newIconConfig;
        this.debugLog('默认图标已设置:', newIconConfig);
    }

    this.closeModals();
};

RoadbookApp.prototype.showConnectModal = function() {
    if (this.markers.length < 2) {
        this.showSwalAlert('提示', '需要至少2个标记点才能连接！', 'warning');
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

    // 初始化时更新推荐的交通方式
    this.updateRecommendedTransportInModal();
};

RoadbookApp.prototype.createConnection = function(startMarker, endMarker, transportType, dateTime = null) {
    if (!startMarker || !endMarker) {
        console.error('创建连接失败：起始点或终点无效。');
        return;
    }

    // 禁止自己连接自己
    if (startMarker.id === endMarker.id) {
        console.error('创建连接失败：起始点和终点不能相同。');
        return;
    }

    const distance = startMarker.marker.getLatLng().distanceTo(endMarker.marker.getLatLng()); // in meters

    // 优先使用传入的交通方式，如果没有则根据距离自动计算推荐方式
    let finalTransport = transportType;
    if (!finalTransport) {
        finalTransport = this.getRecommendedTransport(distance);
    }

    const estimatedDuration = this.estimateDuration(distance, finalTransport);

    console.log(`创建连接线: ${startMarker.title} -> ${endMarker.title}, 距离: ${(distance / 1000).toFixed(2)} km, 交通: ${finalTransport}, 预估时间: ${estimatedDuration} 小时`);

    // 创建连接线
    const polyline = L.polyline([
        [startMarker.position[0], startMarker.position[1]],
        [endMarker.position[0], endMarker.position[1]]
    ], {
        color: this.getTransportColor(finalTransport),
        weight: 6,
        opacity: 1.0,
        smoothFactor: 1.0
    }).addTo(this.map);

    // 创建箭头
    const arrowHead = this.createArrowHead(startMarker.position, endMarker.position, finalTransport);
    arrowHead.addTo(this.map);

    // 添加终点标记（小圆点）
    const endCircle = L.circleMarker([endMarker.position[0], endMarker.position[1]], {
        radius: 6,
        fillColor: this.getTransportColor(finalTransport),
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 1
    }).addTo(this.map);

    // 计算中点位置并添加交通图标
    const startLat = parseFloat(startMarker.position[0]);
    const startLng = parseFloat(startMarker.position[1]);
    const endLat = parseFloat(endMarker.position[0]);
    const endLng = parseFloat(endMarker.position[1]);

    if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
        console.error('连接线坐标无效:', startMarker.position, endMarker.position);
        this.showSwalAlert('错误', '坐标数据错误，请重新选择标记点！', 'error');
        return;
    }

    const fallbackMidLat = (startLat + endLat) / 2;
    const fallbackMidLng = (startLng + endLng) / 2;
    const midPos = this.getPointOnConnection(startMarker.position, endMarker.position, 0.5) || [fallbackMidLat, fallbackMidLng];
    const transportIcon = this.getTransportIcon(finalTransport);
    const iconMarker = L.marker(midPos, {
        icon: L.divIcon({
            className: 'transport-icon',
            html: `<div style="background-color: white; border: 2px solid ${this.getTransportColor(finalTransport)}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${transportIcon}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        })
    }).addTo(this.map);

    let connectionDateTime = dateTime;
    if (!connectionDateTime) {
        // 使用起始点的时间作为连接线的默认时间
        connectionDateTime = this.getCurrentLocalDateTime();
        if (startMarker.dateTimes && startMarker.dateTimes.length > 0) {
            connectionDateTime = startMarker.dateTimes[0];
        } else if (startMarker.dateTime) {
            connectionDateTime = startMarker.dateTime;
        }
    }

    const connection = {
        id: Date.now(),
        startId: startMarker.id,
        endId: endMarker.id,
        transportType: finalTransport,
        polyline: polyline,
        endCircle: endCircle,
        iconMarker: iconMarker,
        arrowHead: arrowHead,
        dateTime: connectionDateTime,
        label: '',
        logo: null,
        duration: estimatedDuration,
        startTitle: startMarker.title,
        endTitle: endMarker.title
    };

    const self = this;
    polyline.on('click', function (e) {
        L.DomEvent.stopPropagation(e);
        if (self.isMobileDevice()) {
            const startMarker = self.markers.find(m => m.id === connection.startId);
            const endMarker = self.markers.find(m => m.id === connection.endId);
            const popupContent = self.generateConnectionPopupContent(connection, startMarker, endMarker);
            polyline.bindPopup(popupContent).openPopup();
        } else {
            self.showConnectionDetail(connection);
        }
    });
    polyline.on('mouseover', function (e) {
        self.showConnectionTooltip(connection, e.latlng, e);
    });
    polyline.on('mouseout', function () {
        self.hideConnectionTooltip();
    });

    // 绑定图标点击事件
    iconMarker.on('click', function (e) {
        L.DomEvent.stopPropagation(e);
        if (self.isMobileDevice()) {
            const startMarker = self.markers.find(m => m.id === connection.startId);
            const endMarker = self.markers.find(m => m.id === connection.endId);
            const popupContent = self.generateConnectionPopupContent(connection, startMarker, endMarker);
            polyline.bindPopup(popupContent).openPopup();
        } else {
            self.showConnectionDetail(connection);
        }
    });
    iconMarker.on('mouseover', function (e) {
        self.showConnectionTooltip(connection, e.latlng, e);
    });
    iconMarker.on('mouseout', function () {
        self.hideConnectionTooltip();
    });

    this.connections.push(connection);

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

    this.saveToLocalStorage();
    this.showConnectionDetail(connection);
    console.log('连接线创建成功，连接数:', this.connections.length);
};

RoadbookApp.prototype.connectMarkers = function() {
    const startSelect = document.getElementById('startMarker');
    const endSelect = document.getElementById('endMarker');
    const transportSelect = document.getElementById('transportType');

    if (!startSelect || !endSelect || !transportSelect) {
        console.error('连接模态框元素不存在');
        return;
    }

    const startIndex = startSelect.value;
    const endIndex = endSelect.value;
    const transportType = transportSelect.value || 'car';

    if (startIndex === endIndex) {
        this.showSwalAlert('提示', '起始点和目标点不能相同！', 'warning');
        return;
    }

    const startMarker = this.markers[startIndex];
    const endMarker = this.markers[endIndex];

    this.createConnection(startMarker, endMarker, transportType);

    this.closeModals();
};

RoadbookApp.prototype.showLabelModal = function() {
    if (this.markers.length === 0) {
        this.showSwalAlert('提示', '需要先添加标记点！', 'warning');
        return;
    }

    const labelSelect = document.getElementById('labelMarker');
    labelSelect.innerHTML = '';

    this.markers.forEach((marker, index) => {
        const option = new Option(marker.title, index);
        labelSelect.add(option);
    });

    document.getElementById('labelModal').style.display = 'block';
};

RoadbookApp.prototype.addLabel = function() {
    const markerIndex = document.getElementById('labelMarker').selectedIndex;
    const content = document.getElementById('labelContent').value.trim();

    if (!content) {
        this.showSwalAlert('提示', '请输入标注内容！', 'warning');
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
    this.labels.push({marker: marker, label: labelMarker, content: content});

    document.getElementById('labelContent').value = '';
    this.closeModals();
};

RoadbookApp.prototype.updateConnections = function() {
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
            const fallbackMidLat = (startLat + endLat) / 2;
            const fallbackMidLng = (startLng + endLng) / 2;
            const midPos = this.getPointOnConnection(startMarker.position, endMarker.position, 0.5) || [fallbackMidLat, fallbackMidLng];
            conn.iconMarker.setLatLng(midPos);
        }

        // 更新箭头位置
        if (conn.arrowHead) {
            const newArrow = this.createArrowHead(startMarker.position, endMarker.position, conn.transportType);
            conn.arrowHead.remove();
            conn.arrowHead = newArrow;
            conn.arrowHead.addTo(this.map);
        }
    });
};

RoadbookApp.prototype.updateLabels = function() {
    this.labels.forEach(labelData => {
        labelData.label.setLatLng([labelData.marker.position[0], labelData.marker.position[1]]);
    });
};

RoadbookApp.prototype.autoFitMapView = function() {
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
                    // console.log(`添加标记点到边界: [${lat}, ${lng}]`);
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
                                    // console.log(`添加连接线点到边界: [${lat}, ${lng}]`);
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
};

RoadbookApp.prototype.autoFitMapViewAfterFilter = function() {
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
                        // console.log(`添加筛选后标记点到边界: [${lat}, ${lng}]`);
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
};

RoadbookApp.prototype.clearAll = function() {
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
};

RoadbookApp.prototype.clearRoadbook = function() {
    this.clearAll(); // 清除所有地图元素和内部数据
    localStorage.removeItem('roadbookData'); // 清除本地缓存
    console.log('路书数据和本地缓存已清空。');
};

RoadbookApp.prototype.showMarkerContextMenu = async function(markerData) {
    // 简单的右键菜单
    const result = await this.showSwalConfirm('删除确认', `要删除标记点"${markerData.title}"吗？`, '删除', '取消');
    if (result.isConfirmed) {
        this.removeMarker(markerData);
    }
};

RoadbookApp.prototype.removeConnection = function(connection, options = {}) {
    if (!connection) return;

    if (!options.skipHistory) {
        // 记录删除连接操作到历史栈
        this.addHistory('removeConnection', {
            id: connection.id,
            startId: connection.startId,
            endId: connection.endId,
            transportType: connection.transportType,
            dateTime: connection.dateTime,
            label: connection.label,
            logo: connection.logo || null,
            duration: connection.duration,
            startTitle: connection.startTitle,
            endTitle: connection.endTitle
        });
    }

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
};

RoadbookApp.prototype.removeMarker = function(markerData, options = {}) {
    // 先收集将被删除的相关连接线数据（用于撤销时恢复）
    const removedConnections = (this.connections || [])
        .filter(conn => conn && (conn.startId === markerData.id || conn.endId === markerData.id))
        .map(conn => ({
            id: conn.id,
            startId: conn.startId,
            endId: conn.endId,
            transportType: conn.transportType,
            dateTime: conn.dateTime,
            label: conn.label,
            logo: conn.logo || null,
            duration: conn.duration,
            startTitle: conn.startTitle,
            endTitle: conn.endTitle
        }));

    if (!options.skipHistory) {
        // 记录删除操作到历史栈
        this.addHistory('removeMarker', {
            id: markerData.id,
            position: [...markerData.position],
            title: markerData.title,
            labels: [...markerData.labels], // 复制数组
            logo: markerData.logo || null,
            icon: { ...markerData.icon }, // 复制对象
            createdAt: markerData.createdAt,
            dateTimes: [...markerData.dateTimes],
            dateTime: markerData.dateTime,
            removedConnections
        });
    }

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
};

RoadbookApp.prototype.showBatchOperationModal = function(selectedMarkers) {
    const isAIEnabled = window.aiAssistant && window.aiAssistant.enabled;

    // Base configuration
    let swalConfig = {
        title: '批量操作',
        text: `已选中 ${selectedMarkers.length} 个标记点，请选择操作`,
        icon: 'question',
        showCancelButton: true,
        cancelButtonText: '取消',
        reverseButtons: true
    };

    if (isAIEnabled) {
        // AI Enabled: Show AI button as primary, Delete as secondary (deny)
        Object.assign(swalConfig, {
            showDenyButton: true,
            confirmButtonText: '🦄 问问 AI',
            denyButtonText: '🗑️ 删除',
            confirmButtonColor: '#667eea',
            denyButtonColor: '#d33'
        });
    } else {
        // AI Disabled: Show Delete button as primary
        Object.assign(swalConfig, {
            showDenyButton: false,
            confirmButtonText: '🗑️ 删除',
            confirmButtonColor: '#d33'
        });
    }

    Swal.fire(swalConfig).then((result) => {
        if (isAIEnabled) {
            if (result.isConfirmed) {
                // Clicked "Ask AI"
                window.aiAssistant.askAboutMarkers(selectedMarkers);
            } else if (result.isDenied) {
                // Clicked "Delete"
                this.deleteMarkers(selectedMarkers);
            }
        } else {
            if (result.isConfirmed) {
                // Clicked "Delete" (when AI is disabled, confirm is delete)
                this.deleteMarkers(selectedMarkers);
            }
        }
    });
};

RoadbookApp.prototype.deleteMarkers = async function(markers) {
    const result = await this.showSwalConfirm('删除确认', `确定要删除选中的 ${markers.length} 个标记点吗？`, '删除', '取消');
    if (result.isConfirmed) {
        const markersToDelete = [...markers];
        let count = 0;

        // 批量删除，暂时直接循环调用
        markersToDelete.forEach(marker => {
            // 检查标记点是否仍然存在（可能已被删除）
            if (this.markers.includes(marker)) {
                this.removeMarker(marker);
                count++;
            }
        });

        this.showSwalAlert('成功', `已删除 ${count} 个标记点`, 'success');
    }
};
