// ============================================================
// 历史记录（撤销/重做）相关方法
// ============================================================

// 添加方法到类中
RoadbookApp.prototype.addHistory = function(operation, data) {
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
};

// 撤销操作
RoadbookApp.prototype.undo = function() {
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
};

/**
 * 刷新待恢复的连接线队列
 */
RoadbookApp.prototype.flushPendingConnectionRestores = function() {
    if (!Array.isArray(this.pendingConnectionRestores) || this.pendingConnectionRestores.length === 0) return;

    const remaining = [];
    this.pendingConnectionRestores.forEach((connData) => {
        if (!connData || typeof connData !== 'object') return;

        // 已经存在则无需再恢复
        if (this.connections && this.connections.some(c => c && c.id === connData.id)) return;

        const startMarker = this.markers.find(m => m.id === connData.startId);
        const endMarker = this.markers.find(m => m.id === connData.endId);
        if (!startMarker || !endMarker) {
            remaining.push(connData);
            return;
        }

        // 复用现有撤销删除连接线逻辑
        this.undoRemoveConnection(connData);
    });

    this.pendingConnectionRestores = remaining;
};

/**
 * 撤销添加标记点
 */
RoadbookApp.prototype.undoAddMarker = function(data) {
    // 查找要撤销的标记点
    const markerIndex = this.markers.findIndex(m => m.id === data.id);
    if (markerIndex !== -1) {
        const marker = this.markers[markerIndex];
        this.removeMarker(marker, { skipHistory: true });
        console.log(`已撤销添加标记点: ${data.title}`);
        return true;
    }
    console.warn('找不到要撤销的标记点:', data);
    return false;
};

/**
 * 撤销删除标记点
 */
RoadbookApp.prototype.undoRemoveMarker = function(data) {
    // 重新添加标记点
    const icon = this.createMarkerIcon(data.icon, this.markers.length + 1);

    const marker = L.marker([data.position[0], data.position[1]], {
        icon: icon,
        draggable: !this.isMobileDevice(),
        title: data.title
    }).addTo(this.map);

    const markerData = {
        id: data.id,
        marker: marker,
        position: data.position,
        title: data.title,
        labels: data.labels || [],
        logo: data.logo || null,  // 添加logo属性
        icon: data.icon,
        createdAt: data.createdAt,
        dateTimes: data.dateTimes || [data.dateTime],
        dateTime: data.dateTimes ? data.dateTimes[0] : data.dateTime
    };

    this.markers.push(markerData);

    // 添加事件监听
    marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (this.isMobileDevice()) {
            const popupContent = this.generateMarkerPopupContent(markerData);
            marker.bindPopup(popupContent).openPopup();
        } else {
            this.showMarkerDetail(markerData);
        }
    });

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

    // 如果删除标记点时同步删除了相关连接线，这里尝试一并恢复
    if (data && Array.isArray(data.removedConnections) && data.removedConnections.length > 0) {
        data.removedConnections.forEach((connData) => {
            if (!connData || typeof connData !== 'object') return;

            // 已经存在则跳过
            if (this.connections && this.connections.some(c => c && c.id === connData.id)) return;

            const startMarker = this.markers.find(m => m.id === connData.startId);
            const endMarker = this.markers.find(m => m.id === connData.endId);
            if (startMarker && endMarker) {
                this.undoRemoveConnection(connData);
            } else {
                // 如果两端点还没被恢复，先放入待恢复队列，等后续撤销其它点时再尝试
                this.pendingConnectionRestores.push(connData);
            }
        });
    }

    // 顺带尝试恢复之前因端点缺失而延迟的连接线
    this.flushPendingConnectionRestores();

    console.log(`已撤销删除标记点: ${data.title}`);
    return true;
};

/**
 * 撤销添加连接线
 */
RoadbookApp.prototype.undoAddConnection = function(data) {
    // 查找要撤销的连接线
    const connectionIndex = this.connections.findIndex(c => c.id === data.id);
    if (connectionIndex !== -1) {
        const connection = this.connections[connectionIndex];
        this.removeConnection(connection, { skipHistory: true });
        console.log('已撤销添加连接线');
        return true;
    }
    console.warn('找不到要撤销的连接线:', data);
    return false;
};

/**
 * 撤销删除连接线
 */
RoadbookApp.prototype.undoRemoveConnection = function(data) {
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

    const fallbackMidLat = (startLat + endLat) / 2;
    const fallbackMidLng = (startLng + endLng) / 2;
    const midPos = this.getPointOnConnection(startMarker.position, endMarker.position, 0.5) || [fallbackMidLat, fallbackMidLng];
    const transportIcon = this.getTransportIcon(data.transportType);

    const iconMarker = L.marker(midPos, {
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
        logo: data.logo || null,  // 添加logo属性
        duration: data.duration || 0,
        startTitle: data.startTitle || startMarker.title,
        endTitle: data.endTitle || endMarker.title
    };

    // 添加连接线事件
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

    polyline.on('mouseover', function (e) {
        self.showConnectionTooltip(connection, e.latlng);
    });

    polyline.on('mouseout', function () {
        self.hideConnectionTooltip();
    });

    this.connections.push(connection);

    console.log('已撤销删除连接线');
    return true;
};

/**
 * 撤销移动标记点
 */
RoadbookApp.prototype.undoMoveMarker = function(data) {
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
};
