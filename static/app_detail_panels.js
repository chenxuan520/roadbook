// app_detail_panels.js - 详情面板相关方法

RoadbookApp.prototype.showConnectionDetail = function(connectionData) {
        // 如果当前处于筛选模式，则退出筛选模式但保持当前视图
        this.checkAndHandleFilterMode();

        // 移动端自动展开侧边栏
        if (this.isMobileDevice()) {
            const rightPanel = document.querySelector('.right-panel');
            const menuToggleBtn = document.getElementById('menuToggleBtn');
            if (rightPanel && menuToggleBtn) {
                rightPanel.classList.add('active');
                menuToggleBtn.textContent = '✕';
            }
        }

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
        const connectionLabelsInput = document.getElementById('connectionLabelsInput');
        if (connectionLabelsInput) {
            connectionLabelsInput.value = connectionData.label || '';
            // Also update the link preview when showing the detail
            const targetContainer = document.getElementById('connectionLabelsLinks');
            this.updateLinkPreview(connectionLabelsInput, targetContainer);
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

        // 更新小红书链接
        this.updateXiaohongshuLink(connectionData);

        // 显示Logo链接
        const connectionLogoInput = document.getElementById('connectionLogoInput');
        if (connectionLogoInput) {
            connectionLogoInput.value = connectionData.logo || '';

            // --- Logo 预览功能 (优化版) ---
            let previewContainer = document.getElementById('connectionLogoPreviewContainer');
            if (!previewContainer) {
                previewContainer = document.createElement('div');
                previewContainer.id = 'connectionLogoPreviewContainer';
                previewContainer.className = 'detail-logo-preview-container';
                connectionLogoInput.parentNode.insertBefore(previewContainer, connectionLogoInput.nextSibling);
            }

            const updatePreview = (url) => {
                const trimmedUrl = url.trim();
                if (trimmedUrl && (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://'))) {
                    // 预加载图片
                    const tempImg = new Image();
                    tempImg.onload = () => {
                        // 加载成功后才显示
                        previewContainer.innerHTML = `<img src="${trimmedUrl}" class="detail-logo-preview-img" alt="Logo Preview">`;
                        previewContainer.style.display = 'block';
                    };
                    tempImg.onerror = () => {
                        // 加载失败则隐藏
                        previewContainer.style.display = 'none';
                    };
                    tempImg.src = trimmedUrl;
                } else {
                    // URL无效或为空则隐藏
                    previewContainer.style.display = 'none';
                }
            };

            // 绑定 change 和 paste 事件
            const handleInputChange = () => {
                updatePreview(connectionLogoInput.value);
            };
            connectionLogoInput.onchange = handleInputChange;
            connectionLogoInput.onpaste = () => {
                // onpaste 后立即触发更新
                setTimeout(handleInputChange, 0);
            };

            // 初始化预览
            updatePreview(connectionData.logo || '');
            // --- 预览功能结束 ---
        }

        // 隐藏标记点详情面板，显示连接线详情面板
        const markerDetailPanel = document.getElementById('markerDetailPanel');
        if (markerDetailPanel) {
            markerDetailPanel.style.display = 'none';
        }
        const connectionDetailPanel = document.getElementById('connectionDetailPanel');
        if (connectionDetailPanel) {
            connectionDetailPanel.style.display = 'block';
        }
    };

    // 更新导航链接
RoadbookApp.prototype.updateNavigationLinks = function(connectionData) {
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

        // 生成Google导航链接
        const googleLink = `https://www.google.com/maps/dir/?api=1&origin=${startLat},${startLng}&destination=${endLat},${endLng}`;
        const googleNavLink = document.getElementById('googleNavLink');
        if (googleNavLink) {
            googleNavLink.href = googleLink;
            googleNavLink.target = '_blank';
        }

        // 更新购票服务链接
        this.updateTicketBookingLinks(connectionData);
    };

    // 获取交通枢纽信息
RoadbookApp.prototype.getTrafficInfo = async function(lat, lon) {
        if (lat === undefined || lon === undefined) {
            throw new Error("无效的坐标");
        }
        const response = await fetch(`${apiBaseUrl}/api/trafficpos?lat=${lat}&lon=${lon}`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`交通信息API请求失败: ${response.status} ${errorText}`);
        }
        return await response.json();
    };

    // 更新购票服务链接的显示和事件绑定
RoadbookApp.prototype.updateTicketBookingLinks = function(connectionData) {
        const ticketBookingSection = document.getElementById('ticketBookingSection');
        const ctripTrainLink = document.getElementById('ctripTrainLink');
        const planeTicketBtn = document.getElementById('planeTicketBtn');

        if (!ticketBookingSection || !ctripTrainLink || !planeTicketBtn) {
            console.error('购票服务元素不存在');
            return;
        }

        // 重置状态
        ticketBookingSection.style.display = 'none';
        ctripTrainLink.style.display = 'none';
        planeTicketBtn.style.display = 'none';

        const transportType = connectionData.transportType;

        if (transportType === 'train') {
            ticketBookingSection.style.display = 'block';
            ctripTrainLink.style.display = 'inline-block';
            ctripTrainLink.textContent = '🚄 携程火车票';
            // 为<a>标签绑定点击事件来触发异步逻辑
            ctripTrainLink.onclick = (e) => {
                e.preventDefault(); // 阻止<a>标签的默认跳转行为
                this.handleTrainTicketClick(connectionData);
            };
        } else if (transportType === 'plane') {
            ticketBookingSection.style.display = 'block';
            planeTicketBtn.style.display = 'inline-block';
            planeTicketBtn.textContent = '✈️ 查询飞机票';
            // 为<button>标签绑定点击事件
            planeTicketBtn.onclick = () => {
                this.handlePlaneTicketClick(connectionData);
            };
        }
    };

    // 处理火车票点击
RoadbookApp.prototype.handleTrainTicketClick = async function(connectionData) {
        Swal.fire({
            title: '正在查询火车站...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            const startMarker = this.markers.find(m => m.id === connectionData.startId);
            const endMarker = this.markers.find(m => m.id === connectionData.endId);

            if (!startMarker || !endMarker) throw new Error('无法找到路线的起点或终点。');

            const [startInfo, endInfo] = await Promise.all([
                this.getTrafficInfo(startMarker.position[0], startMarker.position[1]),
                this.getTrafficInfo(endMarker.position[0], endMarker.position[1])
            ]);

            const startStation = startInfo.nearest_station.name;
            const endStation = endInfo.nearest_station.name;
            if (!startStation || !endStation) throw new Error('未能获取有效的火车站名称。');

            let travelDate = new Date().toISOString().split('T')[0];
            if (connectionData.dateTime) {
                try {
                    const date = new Date(connectionData.dateTime);
                    travelDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                } catch (e) { /* 忽略错误，使用默认日期 */}
            }

            const ctripLink = `https://trains.ctrip.com/webapp/train/list?ticketType=0&dStation=${encodeURIComponent(startStation)}&aStation=${encodeURIComponent(endStation)}&dDate=${travelDate}&rDate=&trainsType=gaotie-dongche`;

            Swal.close();
            window.open(ctripLink, '_blank');
        } catch (error) {
            Swal.fire('查询失败', error.message, 'error');
        }
    };

    // 处理飞机票点击
RoadbookApp.prototype.handlePlaneTicketClick = async function(connectionData) {
        Swal.fire({
            title: '正在查询机场信息...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            const startMarker = this.markers.find(m => m.id === connectionData.startId);
            const endMarker = this.markers.find(m => m.id === connectionData.endId);

            if (!startMarker || !endMarker) throw new Error('无法找到路线的起点或终点。');

            const [startInfo, endInfo] = await Promise.all([
                this.getTrafficInfo(startMarker.position[0], startMarker.position[1]),
                this.getTrafficInfo(endMarker.position[0], endMarker.position[1])
            ]);

            const startAirportCode = startInfo.nearest_airport.code;
            const endAirportCode = endInfo.nearest_airport.code;
            if (!startAirportCode || !endAirportCode) throw new Error('未能获取有效的机场代码。');

            let travelDate = new Date().toISOString().split('T')[0];
            if (connectionData.dateTime) {
                try {
                    const date = new Date(connectionData.dateTime);
                    travelDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                } catch (e) { /* 忽略错误，使用默认日期 */}
            }

            const ctripLink = `https://flights.ctrip.com/online/list/oneway-${startAirportCode}-${endAirportCode}?depdate=${travelDate}`;

            Swal.close();
            window.open(ctripLink, '_blank');
        } catch (error) {
            Swal.fire('查询失败', error.message, 'error');
        }
    };

RoadbookApp.prototype.showMarkerDetail = function(markerData) {
        // 如果当前处于筛选模式，则退出筛选模式但保持当前视图
        this.checkAndHandleFilterMode();

        // 移动端自动展开侧边栏
        if (this.isMobileDevice()) {
            const rightPanel = document.querySelector('.right-panel');
            const menuToggleBtn = document.getElementById('menuToggleBtn');
            if (rightPanel && menuToggleBtn) {
                rightPanel.classList.add('active');
                menuToggleBtn.textContent = '✕';
            }
        }

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
            // Also update the link preview when showing the detail
            const targetContainer = document.getElementById('markerLabelsLinks');
            this.updateLinkPreview(markerLabelsInput, targetContainer);
        }

        // 插入“相关的线路”列表 ---
        // 1. 查找或创建容器
        let formGroupContainer = document.getElementById('relatedConnectionsFormGroup');
        if (!formGroupContainer) {
            formGroupContainer = document.createElement('div');
            formGroupContainer.id = 'relatedConnectionsFormGroup';
            formGroupContainer.className = 'form-group';

            const connectionsContainer = document.createElement('div');
            connectionsContainer.id = 'relatedConnectionsContainer';
            connectionsContainer.className = 'related-connections-container';
            formGroupContainer.appendChild(connectionsContainer);

            // 插入到“标注内容”输入框的父节点之后
            const labelsInputContainer = document.getElementById('markerLabelsInput').parentNode;
            if (labelsInputContainer) {
                labelsInputContainer.parentNode.insertBefore(formGroupContainer, labelsInputContainer.nextSibling);
            }
        }

        // 2. 清空旧内容并生成新列表
        const connectionsContainer = document.getElementById('relatedConnectionsContainer');
        connectionsContainer.innerHTML = '';

        const relatedConnections = this.connections.filter(
            conn => conn.startId === markerData.id || conn.endId === markerData.id
        );

        if (relatedConnections.length > 0) {
            formGroupContainer.style.display = 'block';
            const title = document.createElement('h4');
            title.className = 'related-connections-title';
            title.textContent = '相关的线路';
            connectionsContainer.appendChild(title);

            relatedConnections.forEach(conn => {
                const item = document.createElement('div');
                item.className = 'related-connection-item';

                const isOutgoing = conn.startId === markerData.id;
                const otherMarkerId = isOutgoing ? conn.endId : conn.startId;
                const otherMarker = this.markers.find(m => m.id === otherMarkerId);
                const otherMarkerName = otherMarker ? otherMarker.title : '未知地点';

                item.innerHTML = `
                    <span class="connection-arrow">${isOutgoing ? '➡️' : '⬅️'}</span>
                    <span class="connection-text">${isOutgoing ? '前往' : '来自'}: <strong>${otherMarkerName}</strong></span>
                    <span class="connection-transport-icon">${this.getTransportIcon(conn.transportType)}</span>
                `;

                item.addEventListener('click', () => {
                    this.showConnectionDetail(conn);
                });

                connectionsContainer.appendChild(item);
            });
        } else {
            formGroupContainer.style.display = 'none';
        }
        // --- “相关的线路”列表逻辑结束 ---

        // 更新当前图标
        this.updateCurrentIconPreview(markerData.icon);

        // 更新 Google Maps 酒店搜索链接
        const hotelSearchSection = document.getElementById('hotelSearchSection');
        const googleHotelsLink = document.getElementById('googleHotelsLink');
        if (hotelSearchSection && googleHotelsLink && markerData.position && markerData.position.length === 2) {
            const lat = markerData.position[0];
            const lon = markerData.position[1];
            googleHotelsLink.href = `https://www.google.com/maps/search/hotels/@${lat},${lon},15z`;
            hotelSearchSection.style.display = 'block';
        } else if (hotelSearchSection) {
            hotelSearchSection.style.display = 'none';
        }

        // 更新小红书链接
        this.updateXiaohongshuLink(markerData);

        // 显示Logo链接
        const markerLogoInput = document.getElementById('markerLogoInput');
        if (markerLogoInput) {
            markerLogoInput.value = markerData.logo || '';

            // --- Logo 预览功能 (优化版) ---
            let previewContainer = document.getElementById('markerLogoPreviewContainer');
            if (!previewContainer) {
                previewContainer = document.createElement('div');
                previewContainer.id = 'markerLogoPreviewContainer';
                previewContainer.className = 'detail-logo-preview-container';
                markerLogoInput.parentNode.insertBefore(previewContainer, markerLogoInput.nextSibling);
            }

            const updatePreview = (url) => {
                const trimmedUrl = url.trim();
                if (trimmedUrl && (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://'))) {
                    // 预加载图片
                    const tempImg = new Image();
                    tempImg.onload = () => {
                        // 加载成功后才显示
                        previewContainer.innerHTML = `<img src="${trimmedUrl}" class="detail-logo-preview-img" alt="Logo Preview">`;
                        previewContainer.style.display = 'block';
                    };
                    tempImg.onerror = () => {
                        // 加载失败则隐藏
                        previewContainer.style.display = 'none';
                    };
                    tempImg.src = trimmedUrl;
                } else {
                    // URL无效或为空则隐藏
                    previewContainer.style.display = 'none';
                }
            };

            // 绑定 change 和 paste 事件
            const handleInputChange = () => {
                updatePreview(markerLogoInput.value);
            };
            markerLogoInput.onchange = handleInputChange;
            markerLogoInput.onpaste = () => {
                // onpaste 后立即触发更新
                setTimeout(handleInputChange, 0);
            };

            // 初始化预览
            updatePreview(markerData.logo || '');
            // --- 预览功能结束 ---
        }

        // 隐藏连接线详情面板，显示标记点详情面板
        const connectionDetailPanel = document.getElementById('connectionDetailPanel');
        if (connectionDetailPanel) {
            connectionDetailPanel.style.display = 'none';
        }
        const markerDetailPanel = document.getElementById('markerDetailPanel');
        if (markerDetailPanel) {
            markerDetailPanel.style.display = 'block';
        }
    };

RoadbookApp.prototype.hideMarkerDetail = function() {
        const markerDetailPanel = document.getElementById('markerDetailPanel');
        if (markerDetailPanel) {
            markerDetailPanel.style.display = 'none';
        }
        this.currentMarker = null;
        this.currentConnection = null;
    };

    // 更新时间点显示
RoadbookApp.prototype.updateDateTimesDisplay = function() {
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
    };

    // 更新标记点时间
RoadbookApp.prototype.updateMarkerDateTime = function(index, newDateTime) {
        if (!this.currentMarker || !this.currentMarker.dateTimes) return;

        this.currentMarker.dateTimes[index] = newDateTime;
        this.currentMarker.dateTime = this.currentMarker.dateTimes[0]; // 更新主时间

        // 更新显示
        this.updateDateTimesDisplay();
        this.updateMarkerList();

        // 保存到本地存储
        this.saveToLocalStorage();

        this.debugLog(`标记点"${this.currentMarker.title}"时间点${index + 1}已更新: ${newDateTime}`);
    };

    // 删除标记点时间
RoadbookApp.prototype.deleteMarkerDateTime = async function(index) {
        if (!this.currentMarker || !this.currentMarker.dateTimes || this.currentMarker.dateTimes.length <= 1) {
            this.showSwalAlert('提示', '至少需要保留一个时间点！', 'warning');
            return;
        }

        const result = await this.showSwalConfirm('删除确认', '确定要删除这个时间点吗？', '删除', '取消');
        if (result.isConfirmed) {
            this.currentMarker.dateTimes.splice(index, 1);
            this.currentMarker.dateTime = this.currentMarker.dateTimes[0]; // 更新主时间

            // 更新显示
            this.updateDateTimesDisplay();
            this.updateMarkerList();

            // 保存到本地存储
            this.saveToLocalStorage();

            this.debugLog(`标记点"${this.currentMarker.title}"时间点已删除，剩余${this.currentMarker.dateTimes.length}个时间点`);
        }
    };

    // 添加新的时间点
RoadbookApp.prototype.addMarkerDateTime = function() {
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

        this.debugLog(`标记点"${this.currentMarker.title}"添加新时间点: ${newDateTime}`);
    };

RoadbookApp.prototype.hideConnectionDetail = function() {
        const connectionDetailPanel = document.getElementById('connectionDetailPanel');
        if (connectionDetailPanel) {
            connectionDetailPanel.style.display = 'none';
        }
        this.currentMarker = null;
        this.currentConnection = null;
    };

RoadbookApp.prototype.updateConnectionTransport = function(connection, transportType) {
        if (!connection) return;

        // 更新连接线的交通方式
        connection.transportType = transportType;

        // 更新地图上的连接线
        this.updateConnectionVisual(connection);

        this.debugLog(`连接线交通方式已更新: ${transportType}`);
    };

RoadbookApp.prototype.updateConnectionVisual = function(connection) {
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
            const fallbackMidLat = (startLat + endLat) / 2;
            const fallbackMidLng = (startLng + endLng) / 2;
            const midPos = this.getPointOnConnection(startMarker.position, endMarker.position, 0.5) || [fallbackMidLat, fallbackMidLng];
            connection.iconMarker.setLatLng(midPos);
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
    };

RoadbookApp.prototype.saveConnectionDetail = function() {
        if (!this.currentConnection) return;

        // 保存连接线详情
        const dateTimeInput = document.getElementById('connectionDateInput');
        if (dateTimeInput && dateTimeInput.value) {
            this.currentConnection.dateTime = dateTimeInput.value;
        }

        // 获取当前选中的交通方式（限定在连接线详情面板，避免与连接弹窗互相干扰）
        const connectionDetailPanel = document.getElementById('connectionDetailPanel');
        const activeTransportBtn = connectionDetailPanel
            ? connectionDetailPanel.querySelector('.transport-btn.active')
            : null;
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
            this.currentConnection.duration = parseFloat(durationInput.value) || 0;
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

                this.debugLog(`连接线更新: ${oldStartTitle} → ${oldEndTitle} 改为 ${newStartMarker.title} → ${newEndMarker.title}`);
            }
        }

        // 更新地图上的连接线显示
        this.updateConnectionVisual(this.currentConnection);

        // 保存Logo链接
        const connectionLogoInput = document.getElementById('connectionLogoInput');
        if (connectionLogoInput) {
            const logoValue = connectionLogoInput.value.trim();
            this.currentConnection.logo = logoValue || null;  // 如果为空则设置为null
        }

        // --- 自动同步日期到标记点 ---
        if (this.currentConnection.dateTime) {
            const startMarker = this.markers.find(m => m.id === this.currentConnection.startId);
            const endMarker = this.markers.find(m => m.id === this.currentConnection.endId);

            [startMarker, endMarker].forEach(marker => {
                this.ensureMarkerDateTime(marker, this.currentConnection.dateTime);
            });
        }

        // 更新连接线列表
        this.updateMarkerList();

        this.debugLog('连接线详情已保存:', this.currentConnection);

        // 关闭详情面板
        // this.hideConnectionDetail(); // 为实时保存而移除

        // 保存到本地存储（移除成功提示）
        this.saveToLocalStorage();
    };

RoadbookApp.prototype.saveMarkerDetail = function() {
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

            // 保存Logo链接
            const markerLogoInput = document.getElementById('markerLogoInput');
            if (markerLogoInput) {
                const logoValue = markerLogoInput.value.trim();
                this.currentMarker.logo = logoValue || null;  // 如果为空则设置为null
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

            // 保存Logo链接
            const connectionLogoInput = document.getElementById('connectionLogoInput');
            if (connectionLogoInput) {
                const logoValue = connectionLogoInput.value.trim();
                this.currentConnection.logo = logoValue || null;  // 如果为空则设置为null
            }
        }

        // this.hideMarkerDetail(); // 为实时保存而移除

        // 保存到本地存储
        this.saveToLocalStorage();
    };

RoadbookApp.prototype.deleteCurrentMarker = async function() {
        if (!this.currentMarker) return;

        const result = await this.showSwalConfirm('删除确认', `确定要删除标记点"${this.currentMarker.title}"吗？`, '删除', '取消');
        if (result.isConfirmed) {
            this.removeMarker(this.currentMarker);
            this.hideMarkerDetail();
        }
    };

RoadbookApp.prototype.deleteCurrentConnection = async function() {
        if (!this.currentConnection) return;

        const result = await this.showSwalConfirm('删除确认', `确定要删除连接线"${this.currentConnection.startTitle} → ${this.currentConnection.endTitle}"吗？`, '删除', '取消');
        if (result.isConfirmed) {
            this.removeConnection(this.currentConnection);
            this.hideConnectionDetail();
        }
    };

RoadbookApp.prototype.showHelpModal = function() {
        document.getElementById('helpModal').style.display = 'block';

        // 懒加载帮助面板内的 Bilibili iframe，避免页面打开即加载第三方资源
        try {
            const iframe = document.getElementById('bilibiliHelpIframe');
            if (iframe) {
                const dataSrc = iframe.getAttribute('data-src');
                const currentSrc = iframe.getAttribute('src') || '';
                if (dataSrc && dataSrc.trim() && currentSrc !== dataSrc) {
                    iframe.setAttribute('src', dataSrc);
                }
            }
        } catch (e) {
            // ignore
        }
    };

RoadbookApp.prototype.closeHelpModal = function() {
        document.getElementById('helpModal').style.display = 'none';
    };

    // 删除当前选中的元素（标记点或连接线）
RoadbookApp.prototype.deleteCurrentElement = function() {
        if (this.currentMarker) {
            // 如果当前选中的是标记点，执行删除标记点操作
            this.deleteCurrentMarker();
        } else if (this.currentConnection) {
            // 如果当前选中的是连接线，执行删除连接线操作
            this.deleteCurrentConnection();
        }
        // 如果都没有选中，不执行任何操作
    };

    // 扩大编辑功能
RoadbookApp.prototype.openExpandModal = function(type, title) {
        const modal = document.getElementById('expandModal');
        const modalTitle = document.getElementById('expandModalTitle');
        const modalTextarea = document.getElementById('expandModalTextarea');

        if (!modal || !modalTitle || !modalTextarea) {
            console.error('扩大编辑弹窗元素未找到');
            return;
        }

        // 根据类型获取当前文本内容
        let currentContent = '';
        if (type === 'marker' && this.currentMarker) {
            currentContent = this.currentMarker.labels.join('; ') || '';
        } else if (type === 'connection' && this.currentConnection) {
            currentContent = this.currentConnection.label || '';
        } else if (type === 'date' && this.currentDate) {
            currentContent = this.getDateNotes(this.currentDate) || '';
        }

        modalTitle.textContent = title;
        modalTextarea.value = currentContent;

        // 保存当前类型，用于处理输入时识别
        this.expandModalType = type;

        modal.style.display = 'flex';

        // 移除已有的事件监听器（防止重复绑定）
        if (this.expandModalInputHandler) {
            modalTextarea.removeEventListener('input', this.expandModalInputHandler);
        }
        if (this.expandModalPasteHandler) {
            modalTextarea.removeEventListener('paste', this.expandModalPasteHandler);
        }

        // 根据类型绑定相应的粘贴处理函数和输入处理函数
        if (type === 'marker') {
            this.expandModalPasteHandler = (e) => this.handleMarkerLabelsPaste(e);
            this.expandModalInputHandler = () => this.syncExpandModalToMarkerLabels(modalTextarea.value);
        } else if (type === 'connection') {
            this.expandModalPasteHandler = (e) => this.handleConnectionLabelsPaste(e);
            this.expandModalInputHandler = () => this.syncExpandModalToConnectionLabels(modalTextarea.value);
        } else if (type === 'date') {
            this.expandModalPasteHandler = (e) => this.handleDateNotesPaste(e);
            this.expandModalInputHandler = () => this.syncExpandModalToDateNotes(modalTextarea.value);
        }

        // 添加粘贴和输入事件监听器
        modalTextarea.addEventListener('paste', this.expandModalPasteHandler);
        modalTextarea.addEventListener('input', this.expandModalInputHandler);

        // 聚焦到textarea并设置光标到末尾
        setTimeout(() => {
            modalTextarea.focus();
            modalTextarea.setSelectionRange(modalTextarea.value.length, modalTextarea.value.length);
        }, 100);
    };

    // 实时同步扩大弹窗内容到标记点标签
RoadbookApp.prototype.syncExpandModalToMarkerLabels = function(content) {
        if (this.currentMarker) {
            this.currentMarker.labels = content.split(';').map(label => label.trim()).filter(label => label);

            // 同步更新原textarea内容
            const markerLabelsInput = document.getElementById('markerLabelsInput');
            if (markerLabelsInput) {
                markerLabelsInput.value = content;
            }

            // 保存到本地存储
            //this.saveToLocalStorage();
        }
    };

    // 实时同步扩大弹窗内容到连接线标签
RoadbookApp.prototype.syncExpandModalToConnectionLabels = function(content) {
        if (this.currentConnection) {
            this.currentConnection.label = content;

            // 同步更新原textarea内容
            const connectionLabelsInput = document.getElementById('connectionLabelsInput');
            if (connectionLabelsInput) {
                connectionLabelsInput.value = content;
            }

            // 保存到本地存储
            //this.saveToLocalStorage();
        }
    };

    // 实时同步扩大弹窗内容到日期备注
RoadbookApp.prototype.syncExpandModalToDateNotes = function(content) {
        if (this.currentDate) {
            if (!this.dateNotes) {
                this.dateNotes = {};
            }
            this.dateNotes[this.currentDate] = content;

            // 同步更新原textarea内容
            const dateNotesInput = document.getElementById('dateNotesInput');
            if (dateNotesInput) {
                dateNotesInput.value = content;
            }

            // 保存到本地存储
            //this.saveToLocalStorage();
        }
    };

    // 绑定扩大弹窗相关事件
RoadbookApp.prototype.bindExpandModalEvents = function() {
        const modal = document.getElementById('expandModal');
        const modalClose = document.querySelector('.expand-modal-close');

        if (!modal || !modalClose) {
            console.error('扩大编辑弹窗元素未找到');
            return;
        }

        // 点击关闭按钮
        modalClose.addEventListener('click', () => {
            this.closeExpandModal();
        });

        // 点击弹窗外部关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeExpandModal();
            }
        });

        // ESC键关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display === 'flex') {
                this.closeExpandModal();
            }
        });
    };

    // 关闭扩大编辑弹窗
RoadbookApp.prototype.closeExpandModal = function() {
        const modal = document.getElementById('expandModal');
        if (modal) {
            modal.style.display = 'none';

            // 移除事件监听器
            const modalTextarea = document.getElementById('expandModalTextarea');
            if (modalTextarea && this.expandModalInputHandler && this.expandModalPasteHandler) {
                modalTextarea.removeEventListener('input', this.expandModalInputHandler);
                modalTextarea.removeEventListener('paste', this.expandModalPasteHandler);
            }
        }
    };
