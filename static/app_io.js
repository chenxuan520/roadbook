// app_io.js - 导入导出与本地存储方法

RoadbookApp.prototype.loadSettingsFromCache = function() {
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
};

RoadbookApp.prototype.checkLocalCache = function() {
    try {
        const savedData = localStorage.getItem('roadbookData');
        if (!savedData || savedData === '{}' || savedData === 'null') {
            return false;
        }
        const data = JSON.parse(savedData);
        // 检查是否有实际的标记点或连接线数据
        return (data.markers && data.markers.length > 0) ||
            (data.connections && data.connections.length > 0) ||
            (data.labels && data.labels.length > 0);
    } catch (error) {
        console.error('检查本地缓存失败:', error);
        return false;
    }
};

RoadbookApp.prototype.saveToLocalStorage = function() {
    const data = {
        version: window.ROADBOOK_APP_VERSION || 'unknown',
        saveTime: new Date().toISOString(),
        currentLayer: this.currentLayer, // 保存当前地图源
        currentSearchMethod: this.currentSearchMethod, // 保存当前搜索方式
        markers: this.markers.map((m) => ({
            id: m.id,
            position: m.position,
            title: m.title,
            labels: m.labels, // 现在labels是字符串数组，直接导出
            logo: m.logo, // 保存logo属性
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
                logo: c.logo, // 保存logo属性
                duration: c.duration || 0, // 保存耗时信息
                startTitle: startMarker ? startMarker.title : c.startTitle,
                endTitle: endMarker ? endMarker.title : c.endTitle
            };
        }),
        labels: this.labels.map(l => ({
            markerIndex: this.markers.indexOf(l.marker),
            content: l.content
        })),
        dateNotes: this.dateNotes || {}, // 保存日期备注信息
        lastDateRange: this.lastDateRange // 保存上次使用的日期范围
    };

    try {
        // console.log('开始保存到本地存储，标记点数量:', this.markers.length);
        // if (this.markers.length > 0) {
        //     this.markers.forEach((marker, index) => {
        //         console.log(`保存标记点 ${index}: ID=${marker.id}, 位置=${marker.position}, 标题=${marker.title}`);
        //     });
        // }

        localStorage.setItem('roadbookData', JSON.stringify(data));
        // console.log('路书数据已保存到本地存储');
    } catch (error) {
        console.error('保存到本地存储失败:', error);
    }
};

RoadbookApp.prototype.loadFromLocalStorage = function() {
    try {
        const savedData = localStorage.getItem('roadbookData');
        if (savedData) {
            const data = JSON.parse(savedData);
            this.debugLog('从本地存储加载路书数据');
            this.debugLog('本地存储数据:', data);

            // 检查标记点位置数据
            // if (data.markers && data.markers.length > 0) {
            //     data.markers.forEach((marker, index) => {
            //         console.log(`标记点 ${index}: ID=${marker.id}, 位置=${marker.position}, 标题=${marker.title}`);
            //     });
            // }

            // 直接加载本地缓存数据，不显示导入提示
            this.loadRoadbook(data, false);

            // 加载日期备注信息
            if (data.dateNotes) {
                this.dateNotes = data.dateNotes;
            } else {
                this.dateNotes = {};
            }

            // 加载上次使用的日期范围
            if (data.lastDateRange) {
                this.lastDateRange = data.lastDateRange;
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
            this.debugLog('没有找到本地缓存数据');

            // 确保UI下拉框显示默认值
            this.updateUISelectsNoEvent(this.currentLayer, this.currentSearchMethod);
        }
    } catch (error) {
        console.error('从本地存储加载数据失败:', error);
    }
};

RoadbookApp.prototype.switchMapSourceWithoutSaving = function(newSource) {
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
};

RoadbookApp.prototype.updateUISelectsNoEvent = function(currentLayer, currentSearchMethod) {
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
};

RoadbookApp.prototype.setSelectValuesNoEvent = function(currentLayer, currentSearchMethod) {
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
};

RoadbookApp.prototype.clearCache = async function() {
    const result = await this.showSwalConfirm('清除确认', '确定要清除本地缓存吗？此操作将删除所有已保存的数据，无法恢复。', '清除', '取消');
    if (result.isConfirmed) {
        try {
            localStorage.removeItem('roadbookData');
            // 清除当前数据
            this.clearAll();
            this.showSwalAlert('成功', '本地缓存已清除！', 'success');
        } catch (error) {
            console.error('清除本地缓存失败:', error);
            this.showSwalAlert('错误', '清除本地缓存失败！', 'error');
        }
    }
};

RoadbookApp.prototype.exportToIcs = function() {
    if (window.htmlExporter) {
        window.htmlExporter.exportToIcs();
    } else {
        console.error('HTML Exporter not found');
        Swal.fire('错误', '导出模块未加载，请刷新页面重试。', 'error');
    }
};

RoadbookApp.prototype.exportRoadbook = function() {
    const data = {
        version: window.ROADBOOK_APP_VERSION || 'unknown',
        exportTime: new Date().toISOString(),
        currentLayer: this.currentLayer, // 导出当前地图源
        currentSearchMethod: this.currentSearchMethod, // 导出当前搜索方式
        markers: this.markers.map((m) => ({
            id: m.id,
            position: m.position,
            title: m.title,
            labels: m.labels, // 现在labels是字符串数组，直接导出
            logo: m.logo, // 保存logo属性
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
                logo: c.logo, // 保存logo属性
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
    const blob = new Blob([json], {type: 'application/json'});
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `roadbook_${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
};

RoadbookApp.prototype.importRoadbook = function(file) {
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

    // 检查是否是PNG图片文件 (隐写术提取 JSON)
    if (file.name.toLowerCase().endsWith('.png')) {
        if (typeof RoadbookHtmlExporter !== 'undefined' && window.htmlExporter) {
            window.htmlExporter.importFromPng(file);
        } else {
            this.showSwalAlert('错误', '导出模块未加载，无法从 PNG 导入！', 'error');
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
            this.showSwalAlert('错误', '文件格式错误！', 'error');
        }
    };
    reader.readAsText(file);
};

RoadbookApp.prototype.importFromHtml = function(file) {
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
                    this.showSwalAlert('错误', 'HTML文件中未找到路书数据！', 'error');
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
            this.showSwalAlert('错误', 'HTML文件格式错误或数据损坏！', 'error');
        }
    };
    reader.readAsText(file);
};

RoadbookApp.prototype.processImportedData = function(data) {
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
};

RoadbookApp.prototype.loadRoadbook = function(data, isImport = true) {
    // 清除现有数据
    this.clearAll();

    let versionWarning = null;

    // 版本兼容性检查
    if (data.version) {
        console.log(`导入路书版本: ${data.version}`);

        // 只有在手动导入时才提示版本问题
        if (isImport) {
            const currentVersion = window.ROADBOOK_APP_VERSION;

            // 确保当前版本不是 unknown 且格式正确
            if (currentVersion && currentVersion !== 'unknown') {
                const compareResult = this.compareVersions(data.version, currentVersion);

                if (compareResult === 1) { // 导入版本 > 当前版本
                    versionWarning = `⚠️ 版本警告: 导入的数据版本 (${data.version}) 高于当前应用版本 (${currentVersion})。<br>可能包含当前版本不支持的特性，建议升级应用。`;
                    console.warn(versionWarning.replace(/<br>/g, '\n'));
                }
            }
        }
    }

    // 加载标记点
    data.markers.forEach(markerData => {
        // console.log(`加载标记点: ID=${markerData.id}, 位置=${markerData.position}, 标题=${markerData.title}`);

        // 使用导入的图标信息或默认图标
        const iconConfig = markerData.icon || {type: 'default', icon: '📍', color: '#667eea'};
        const icon = this.createMarkerIcon(iconConfig, this.markers.length + 1);

        const marker = L.marker([markerData.position[0], markerData.position[1]], {
            icon: icon,
            draggable: !this.isMobileDevice(),
            title: markerData.title
        }).addTo(this.map);

        const markerObj = {
            id: markerData.id,
            marker: marker,
            position: markerData.position,
            title: markerData.title,
            labels: markerData.labels || [], // 导入labels数组
            logo: markerData.logo || null, // 导入logo属性
            icon: markerData.icon || {type: 'default', icon: '📍', color: '#667eea'}, // 导入图标信息
            createdAt: markerData.createdAt,
            dateTimes: markerData.dateTimes || [markerData.dateTime], // 导入多个时间点
            dateTime: markerData.dateTimes ? markerData.dateTimes[0] : markerData.dateTime // 兼容旧版本
        };

        this.markers.push(markerObj);

        // 添加事件监听
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (this.isMobileDevice()) {
                const popupContent = this.generateMarkerPopupContent(markerObj);
                marker.bindPopup(popupContent).openPopup();
            } else {
                this.showMarkerDetail(markerObj);
            }
        });

        marker.on('mouseover', (e) => {
            if (e.target.getElement()) {
                e.target.getElement()._savedTitle = e.target.getElement().getAttribute('title');
                e.target.getElement().removeAttribute('title');
            }
            this.showMarkerTooltip(markerObj, e.latlng, e);
        });

        marker.on('mouseout', (e) => {
            if (e.target.getElement() && e.target.getElement()._savedTitle) {
                e.target.getElement().setAttribute('title', e.target.getElement()._savedTitle);
            }
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

        const fallbackMidLat = (startLat + endLat) / 2;
        const fallbackMidLng = (startLng + endLng) / 2;
        const midPos = this.getPointOnConnection(startMarker.position, endMarker.position, 0.5) || [fallbackMidLat, fallbackMidLng];
        const transportIcon = this.getTransportIcon(connData.transportType);

        const iconMarker = L.marker(midPos, {
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
            logo: connData.logo || null, // 导入logo属性
            duration: connData.duration || 0, // 加载耗时信息
            startTitle: connData.startTitle || startMarker.title,
            endTitle: connData.endTitle || endMarker.title
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
                // Use polyline's popup but trigger from icon marker
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

    // 加载上次使用的日期范围
    if (data.lastDateRange) {
        this.lastDateRange = data.lastDateRange;
    } else {
        // 如果云端没有存储范围，则清空本地的，避免残留上一个计划的筛选状态
        // 这会让 UI 回退到默认逻辑（展示所有点的时间范围）
        this.lastDateRange = null;
    }

    this.updateMarkerList();

    const markerCount = this.markers.length;
    const connectionCount = this.connections.length;

    // 保存到本地存储
    this.saveToLocalStorage();

    // 只在手动导入文件时显示提示
    if (isImport) {
        let title = '导入成功';
        let message = `路书导入成功！\n标记点: ${markerCount} 个\n连接线: ${connectionCount} 条`;
        let icon = 'success';

        if (versionWarning) {
            // 如果有版本警告，使用 HTML 显示，并改变样式
            message = `路书导入成功！<br>标记点: ${markerCount} 个<br>连接线: ${connectionCount} 条<br><br><span style="color: #856404; background-color: #fff3cd; padding: 10px; border-radius: 4px; display: inline-block; text-align: left; font-size: 0.9em; border: 1px solid #ffeeba; width: 100%; box-sizing: border-box;">${versionWarning}</span>`;
        }

        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: title,
                html: versionWarning ? message : message.replace(/\n/g, '<br>'),
                icon: icon,
                confirmButtonText: '确定',
                confirmButtonColor: '#667eea'
            });
        } else {
            this.showSwalAlert(title, message.replace(/<br>/g, '\n'), icon);
        }
    }

    // 自动调整视窗以包含所有元素（取代定位到第一个标记点）
    this.autoFitMapView();
};

RoadbookApp.prototype.createLabelForMarker = function(marker, content) {
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
};
