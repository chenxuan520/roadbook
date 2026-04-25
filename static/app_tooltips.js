// ============================================================
// 提示框（Tooltip）与 Logo 预览相关方法
// ============================================================

/**
 * 显示标记点提示框
 */
RoadbookApp.prototype.showMarkerTooltip = function(markerData, latlng, event) {
    if (event === undefined) event = null;
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
        const labelsHtml = this.convertMarkdownLinksToHtml(markerData.labels.join('; '));
        tooltipContent += '<div>标注: ' + labelsHtml + '</div>';
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

    // 设置当前标记点数据，用于logo预览
    this.currentMarkerDataForTooltip = markerData;

    // 显示logo预览，与tooltip同步
    setTimeout(() => {
        if (markerData.logo && event) {
            this.showLogoPreview(markerData.logo, event);
        }
    }, 50);
};

/**
 * 隐藏标记点提示框
 */
RoadbookApp.prototype.hideMarkerTooltip = function() {
    if (this.markerTooltip) {
        this.markerTooltip.remove();
        this.markerTooltip = null;
    }
    this.currentMarkerDataForTooltip = null;

    // 隐藏logo预览，与tooltip同步
    this.hideLogoPreview();
};

/**
 * 显示连接线提示框
 */
RoadbookApp.prototype.showConnectionTooltip = function(connection, latlng, event) {
    if (event === undefined) event = null;
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
        const labelsHtml = this.convertMarkdownLinksToHtml(connection.label);
        tooltipContent += `<div>标注: ${labelsHtml}</div>`;
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

    // 设置当前连接线数据，用于logo预览
    this.currentConnectionDataForTooltip = connection;

    // 显示logo预览，与tooltip同步
    setTimeout(() => {
        if (connection.logo && event) {
            this.showLogoPreview(connection.logo, event);
        }
    }, 50);
};

/**
 * 隐藏连接线提示框
 */
RoadbookApp.prototype.hideConnectionTooltip = function() {
    if (this.tooltip) {
        this.tooltip.remove();
        this.tooltip = null;
    }
    this.currentConnectionDataForTooltip = null;

    // 隐藏logo预览，与tooltip同步
    this.hideLogoPreview();
};

// 显示logo预览（与 tooltip 同步；兼容 event 或 latlng）
RoadbookApp.prototype.showLogoPreview = function(logoUrl, eventOrLatlng) {
    if (!logoUrl || !eventOrLatlng) {
        this.hideLogoPreview();
        return;
    }

    const logoPreview = document.getElementById('logoPreview');
    const logoPreviewImg = document.getElementById('logoPreviewImg');

    if (!logoPreview || !logoPreviewImg) {
        return;
    }

    // 设置预览图片的源
    logoPreviewImg.src = logoUrl;

    logoPreviewImg.onload = () => {
        // 优先使用事件对象获取鼠标位置（Leaflet 事件：event.originalEvent）
        const oe = eventOrLatlng && eventOrLatlng.originalEvent;
        if (oe && typeof oe.clientX === 'number' && typeof oe.clientY === 'number') {
            logoPreview.style.position = 'fixed';
            logoPreview.style.left = oe.clientX + 'px';
            logoPreview.style.top = (oe.clientY + 15) + 'px'; // 鼠标下方 15px
        } else if (this.map && typeof this.map.latLngToLayerPoint === 'function') {
            // 回退：传入的是 latlng
            const pos = this.map.latLngToLayerPoint(eventOrLatlng);
            logoPreview.style.position = 'absolute';
            logoPreview.style.left = (pos.x + 15) + 'px';
            logoPreview.style.top = (pos.y - 30) + 'px';
        }

        logoPreview.style.display = 'block';
        logoPreview.style.opacity = '0';
        setTimeout(() => {
            logoPreview.style.opacity = '1';
        }, 10);
    };

    // 图片加载失败处理
    logoPreviewImg.onerror = () => {
        logoPreview.style.display = 'none';
    };
};

// 隐藏Logo预览
RoadbookApp.prototype.hideLogoPreview = function() {
    const logoPreview = document.getElementById('logoPreview');
    if (logoPreview) {
        logoPreview.style.display = 'none';
    }
    // 清除logo预览数据
    this.logoPreviewData = null;
};
