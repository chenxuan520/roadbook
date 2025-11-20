class RoadbookApp {
    constructor() {
        this.map = null;
        this.markers = [];
        this.connections = [];
        this.labels = [];
        this.currentMode = 'view';
        this.selectedMarkers = [];

        this.init();
    }

    init() {
        this.initMap();
        this.bindEvents();
    }

    initMap() {
        // 使用OpenStreetMap初始化Leaflet地图
        this.map = L.map('mapContainer').setView([39.90923, 116.397428], 10); // 北京天安门

        // 添加OpenStreetMap图层
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(this.map);

        // 添加地图点击事件
        this.map.on('click', (e) => {
            if (this.currentMode === 'addMarker') {
                this.addMarker(e.latlng);
            }
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

        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.exportRoadbook();
            });
        }

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

        const exportImageBtn = document.getElementById('exportImageBtn');
        if (exportImageBtn) {
            exportImageBtn.addEventListener('click', () => {
                this.exportImage();
            });
        }

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

        const deleteMarkerBtn = document.getElementById('deleteMarkerBtn');
        if (deleteMarkerBtn) {
            deleteMarkerBtn.addEventListener('click', () => {
                this.deleteCurrentMarker();
            });
        }

        // 点击模态框外部关闭
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModals();
            }
        });
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

        // 创建自定义图标
        const icon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="background-color: #667eea; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">${this.markers.length + 1}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        const marker = L.marker([latlng.lat, latlng.lng], {
            icon: icon,
            draggable: true,
            title: `标记点${this.markers.length + 1}`
        }).addTo(this.map);

        const markerData = {
            id: markerId,
            marker: marker,
            position: [latlng.lat, latlng.lng],
            title: `标记点${this.markers.length + 1}`,
            labels: [], // 存储标注文本，不直接显示
            createdAt: new Date().toLocaleString('zh-CN'),
            dateTime: new Date().toLocaleString('zh-CN')
        };

        this.markers.push(markerData);
        this.updateMarkerList();
        this.setMode('view');

        // 添加点击事件显示详情
        marker.on('click', () => {
            this.showMarkerDetail(markerData);
        });

        // 添加右键菜单事件
        marker.on('contextmenu', () => {
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
            markerData.position = [newPos.lat, newPos.lng];

            // 更新连接线
            this.updateConnections();

            // 更新标注位置
            this.updateLabels();

            // 如果当前标记点正在详情面板中显示，更新坐标显示
            if (this.currentMarker === markerData) {
                document.getElementById('markerCoords').textContent =
                    `${newPos.lng.toFixed(6)}, ${newPos.lat.toFixed(6)}`;
            }

            // 更新标记点列表中的坐标显示
            this.updateMarkerList();

            console.log(`标记点"${markerData.title}"坐标已更新: ${newPos.lat.toFixed(6)}, ${newPos.lng.toFixed(6)}`);
        });
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
        const transportType = transportSelect.value;

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

        const connection = {
            id: Date.now(),
            start: startMarker,
            end: endMarker,
            transportType: transportType,
            polyline: polyline,
            endCircle: endCircle,
            iconMarker: iconMarker,
            arrowHead: arrowHead, // 添加箭头
            dateTime: new Date().toLocaleString('zh-CN'),
            label: '',
            startTitle: startMarker.title,
            endTitle: endMarker.title
        };

        // 添加连接线事件 - 使用箭头函数确保this上下文正确
        const self = this;
        polyline.on('click', function() {
            self.showConnectionDetail(connection);
        });

        polyline.on('mouseover', function(e) {
            self.showConnectionTooltip(connection, e.latlng);
            // 同时显示连接线的标注信息
            if (connection.label) {
                self.showConnectionLabelTooltip(connection, e.latlng);
            }
        });

        polyline.on('mouseout', function() {
            self.hideConnectionTooltip();
            self.hideConnectionLabelTooltip();
        });

        this.connections.push(connection);
        this.closeModals();

        console.log('连接线创建成功，连接数:', this.connections.length);
    }

    getTransportColor(type) {
        const colors = {
            car: '#FF5722',
            train: '#2196F3',
            plane: '#4CAF50',
            walk: '#FF9800'
        };
        return colors[type] || '#666';
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

    getTransportTypeName(type) {
        const names = {
            car: '汽车',
            train: '火车',
            plane: '飞机',
            walk: '步行'
        };
        return names[type] || '其他';
    }

    showMarkerTooltip(markerData, latlng) {
        let tooltipContent = `<div style="background: rgba(0,0,0,0.8); color: white; padding: 8px; border-radius: 4px; font-size: 12px;">`;
        tooltipContent += `<div><strong>${markerData.title}</strong></div>`;
        tooltipContent += `<div>坐标: ${markerData.position[1].toFixed(6)}, ${markerData.position[0].toFixed(6)}</div>`;
        if (markerData.dateTime) {
            tooltipContent += `<div>时间: ${markerData.dateTime}</div>`;
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
        let tooltipContent = `<div style="background: rgba(0,0,0,0.8); color: white; padding: 8px; border-radius: 4px; font-size: 12px;">`;
        tooltipContent += `<div><strong>${connection.startTitle} → ${connection.endTitle}</strong></div>`;
        tooltipContent += `<div>${this.getTransportIcon(connection.transportType)} ${this.getTransportTypeName(connection.transportType)}</div>`;
        if (connection.dateTime) {
            tooltipContent += `<div>时间: ${connection.dateTime}</div>`;
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

    showConnectionLabelTooltip(connection, latlng) {
        if (!connection.label) return;

        let tooltipContent = `<div style="background: rgba(0,0,0,0.8); color: white; padding: 8px; border-radius: 4px; font-size: 12px;">`;
        tooltipContent += `<div><strong>连接线标注</strong></div>`;
        tooltipContent += `<div>${connection.label}</div>`;
        tooltipContent += `</div>`;

        if (!this.connectionLabelTooltip) {
            this.connectionLabelTooltip = L.tooltip({
                permanent: false,
                direction: 'bottom',
                className: 'connection-label-tooltip'
            });
        }

        this.connectionLabelTooltip.setContent(tooltipContent);
        this.connectionLabelTooltip.setLatLng(latlng);
        this.connectionLabelTooltip.addTo(this.map);
    }

    hideConnectionLabelTooltip() {
        if (this.connectionLabelTooltip) {
            this.connectionLabelTooltip.remove();
            this.connectionLabelTooltip = null;
        }
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
            plane: '✈️',
            walk: '🚶'
        };
        return icons[type] || '•';
    }

    showConnectionDetail(connectionData) {
        this.currentConnection = connectionData;
        this.currentMarker = null;

        // 设置面板标题
        document.getElementById('detailTitle').textContent = '连接线详情';

        // 连接线不需要名称输入
        document.getElementById('markerNameInput').style.display = 'none';

        // 设置日期时间
        if (connectionData.dateTime) {
            const date = new Date(connectionData.dateTime);
            const dateString = date.toISOString().slice(0, 16);
            document.getElementById('markerDateInput').value = dateString;
        } else {
            const now = new Date().toISOString().slice(0, 16);
            document.getElementById('markerDateInput').value = now;
        }
        document.getElementById('markerDateInput').style.display = 'block';

        // 显示连接信息
        document.getElementById('markerCoords').textContent =
            `${connectionData.startTitle} → ${connectionData.endTitle} (${this.getTransportIcon(connectionData.transportType)} ${this.getTransportTypeName(connectionData.transportType)})`;

        // 显示标注内容
        const labelsContent = connectionData.label || '';
        document.getElementById('markerLabelsInput').value = labelsContent;
        document.getElementById('markerLabelsInput').style.display = 'block';
        document.getElementById('markerLabelsInput').placeholder = '输入连接线标注内容';

        // 显示详情面板，隐藏侧边栏
        document.querySelector('.sidebar').style.display = 'none';
        document.getElementById('detailPanel').style.display = 'block';
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

        this.markers.forEach((marker, _) => {
            const item = document.createElement('div');
            item.className = 'marker-item';
            item.innerHTML = `
                <div class="marker-info">
                    <div class="title">${marker.title}</div>
                    <div class="coords">${marker.position[1].toFixed(6)}, ${marker.position[0].toFixed(6)}</div>
                    <div class="date">${marker.createdAt ? marker.createdAt.split(' ')[0] : ''}</div>
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

    updateConnections() {
        this.connections.forEach(conn => {
            if (!conn.start || !conn.end || !conn.start.position || !conn.end.position) {
                console.warn('连接线数据不完整:', conn);
                return;
            }

            const startLat = parseFloat(conn.start.position[0]);
            const startLng = parseFloat(conn.start.position[1]);
            const endLat = parseFloat(conn.end.position[0]);
            const endLng = parseFloat(conn.end.position[1]);

            if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
                console.error('连接线坐标无效:', conn.start.position, conn.end.position);
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
                const newArrow = this.createArrowHead([startLat, startLng], [endLat, endLng], conn.transportType);
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

    exportRoadbook() {
        const data = {
            version: '1.0',
            exportTime: new Date().toISOString(),
            markers: this.markers.map((m, index) => ({
                id: m.id,
                position: m.position,
                title: m.title,
                labels: m.labels, // 现在labels是字符串数组，直接导出
                createdAt: m.createdAt,
                dateTime: m.dateTime,
                markerIndex: index // 添加索引信息，便于导入时重建
            })),
            connections: this.connections.map(c => ({
                id: c.id,
                startIndex: this.markers.indexOf(c.start),
                endIndex: this.markers.indexOf(c.end),
                transportType: c.transportType,
                dateTime: c.dateTime,
                label: c.label,
                startTitle: c.startTitle,
                endTitle: c.endTitle
            })),
            labels: this.labels.map(l => ({
                markerIndex: this.markers.indexOf(l.marker),
                content: l.content
            }))
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

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                this.loadRoadbook(data);
            } catch (error) {
                alert('文件格式错误！');
            }
        };
        reader.readAsText(file);
    }

    loadRoadbook(data) {
        // 清除现有数据
        this.clearAll();

        // 版本兼容性检查
        if (data.version) {
            console.log(`导入路书版本: ${data.version}`);
        }

        // 加载标记点
        data.markers.forEach(markerData => {
            // 创建自定义图标
            const icon = L.divIcon({
                className: 'custom-marker',
                html: `<div style="background-color: #667eea; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">${this.markers.length + 1}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });

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
                createdAt: markerData.createdAt,
                dateTime: markerData.dateTime
            };

            this.markers.push(markerObj);

            // 添加事件监听
            marker.on('click', () => {
                this.showMarkerDetail(markerObj);
            });

            marker.on('contextmenu', () => {
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
                this.updateConnections();
                this.updateLabels();
            });
        });

        // 加载连接线
        data.connections.forEach(connData => {
            const startMarker = this.markers[connData.startIndex];
            const endMarker = this.markers[connData.endIndex];

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
                start: startMarker,
                end: endMarker,
                transportType: connData.transportType,
                polyline: polyline,
                endCircle: endCircle,
                iconMarker: iconMarker,
                arrowHead: arrowHead,
                dateTime: connData.dateTime,
                label: connData.label || '',
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

        this.updateMarkerList();

        const markerCount = this.markers.length;
        const connectionCount = this.connections.length;
        alert(`路书导入成功！\n标记点: ${markerCount} 个\n连接线: ${connectionCount} 条`);
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

    exportImage() {
        // 使用html2canvas库来导出图片
        if (typeof html2canvas === 'undefined') {
            // 动态加载html2canvas库
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
            script.onload = () => {
                this.captureMap();
            };
            document.head.appendChild(script);
        } else {
            this.captureMap();
        }
    }

    captureMap() {
        const mapContainer = document.getElementById('mapContainer');

        html2canvas(mapContainer, {
            useCORS: true,
            scale: 2,
            allowTaint: true,
            backgroundColor: null
        }).then(canvas => {
            const link = document.createElement('a');
            link.download = `roadbook_image_${new Date().toISOString().slice(0, 10)}.png`;
            link.href = canvas.toDataURL();
            link.click();
        }).catch(error => {
            console.error('导出图片失败:', error);
            alert('导出图片失败，请重试！');
        });
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
        this.updateMarkerList();
    }

    showMarkerContextMenu(markerData) {
        // 简单的右键菜单
        if (confirm(`要删除标记点"${markerData.title}"吗？`)) {
            this.removeMarker(markerData);
        }
    }

    removeMarker(markerData) {
        // 删除标记点
        markerData.marker.remove();
        // 标注不再直接显示，无需删除

        // 删除相关连接
        this.connections = this.connections.filter(conn => {
            if (conn.start === markerData || conn.end === markerData) {
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
    }

    showMarkerDetail(markerData) {
        this.currentMarker = markerData;
        this.currentConnection = null;

        // 设置面板标题
        document.getElementById('detailTitle').textContent = '标记点详情';

        // 填充详情面板数据
        document.getElementById('markerNameInput').value = markerData.title;
        document.getElementById('markerNameInput').style.display = 'block';

        // 设置日期时间选择器
        if (markerData.dateTime) {
            // 转换日期时间格式为datetime-local需要的格式
            const date = new Date(markerData.dateTime);
            const dateString = date.toISOString().slice(0, 16);
            document.getElementById('markerDateInput').value = dateString;
        } else {
            // 默认为当前时间
            const now = new Date().toISOString().slice(0, 16);
            document.getElementById('markerDateInput').value = now;
        }
        document.getElementById('markerDateInput').style.display = 'block';

        document.getElementById('markerCoords').textContent =
            `${markerData.position[1].toFixed(6)}, ${markerData.position[0].toFixed(6)}`;

        // 显示标注内容 - 现在labels是字符串数组
        const labelsContent = markerData.labels.join('; ');
        document.getElementById('markerLabelsInput').value = labelsContent || '';
        document.getElementById('markerLabelsInput').style.display = 'block';

        // 显示详情面板，隐藏侧边栏
        document.querySelector('.sidebar').style.display = 'none';
        document.getElementById('detailPanel').style.display = 'block';
    }

    showConnectionDetail(connectionData) {
        this.currentConnection = connectionData;
        this.currentMarker = null;

        // 设置面板标题
        document.getElementById('detailTitle').textContent = '连接线详情';

        // 连接线不需要名称输入
        document.getElementById('markerNameInput').style.display = 'none';

        // 设置日期时间
        if (connectionData.dateTime) {
            const date = new Date(connectionData.dateTime);
            const dateString = date.toISOString().slice(0, 16);
            document.getElementById('markerDateInput').value = dateString;
        } else {
            const now = new Date().toISOString().slice(0, 16);
            document.getElementById('markerDateInput').value = now;
        }
        document.getElementById('markerDateInput').style.display = 'block';

        // 显示连接信息
        document.getElementById('markerCoords').textContent =
            `${connectionData.startTitle} → ${connectionData.endTitle} (${this.getTransportIcon(connectionData.transportType)} ${this.getTransportTypeName(connectionData.transportType)})`;

        // 显示标注内容
        const labelsContent = connectionData.label || '';
        document.getElementById('markerLabelsInput').value = labelsContent;
        document.getElementById('markerLabelsInput').style.display = 'block';
        document.getElementById('markerLabelsInput').placeholder = '输入连接线标注内容';

        // 显示详情面板，隐藏侧边栏
        document.querySelector('.sidebar').style.display = 'none';
        document.getElementById('detailPanel').style.display = 'block';
    }

    hideMarkerDetail() {
        document.getElementById('detailPanel').style.display = 'none';
        document.querySelector('.sidebar').style.display = 'block';
        this.currentMarker = null;
        this.currentConnection = null;
    }

    saveMarkerDetail() {
        if (this.currentMarker) {
            // 保存标记点
            const newName = document.getElementById('markerNameInput').value.trim();
            if (newName) {
                this.currentMarker.title = newName;
                this.currentMarker.marker.setTooltipContent(newName);
            }

            // 保存日期时间
            const dateTimeValue = document.getElementById('markerDateInput').value;
            if (dateTimeValue) {
                this.currentMarker.dateTime = new Date(dateTimeValue).toLocaleString('zh-CN');
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
            const dateTimeValue = document.getElementById('markerDateInput').value;
            if (dateTimeValue) {
                this.currentConnection.dateTime = new Date(dateTimeValue).toLocaleString('zh-CN');
            }

            const labelText = document.getElementById('markerLabelsInput').value.trim();
            this.currentConnection.label = labelText;
        }

        this.hideMarkerDetail();
    }

    deleteCurrentMarker() {
        if (!this.currentMarker) return;

        if (confirm(`确定要删除标记点"${this.currentMarker.title}"吗？`)) {
            this.removeMarker(this.currentMarker);
            this.hideMarkerDetail();
        }
    }

    closeModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
    }
}

// 初始化应用
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new RoadbookApp();
    window.app = app; // 使应用实例全局可访问
});
