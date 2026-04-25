// app_date_filter.js - 日期筛选相关方法

RoadbookApp.prototype.getAllDatesFromMarkers = function() {
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
};

// 获取标记点在指定日期的时间点
RoadbookApp.prototype.getMarkerTimesForDate = function(marker, dateKey) {
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
};

// 按最早时间排序标记点（创建副本避免修改原数组）
RoadbookApp.prototype.sortMarkersByEarliestTime = function(markers, dateKey) {
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
};

// 按日期分组标记点 - 包含所有出现过的日期
RoadbookApp.prototype.groupMarkersByDate = function() {
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
};

// 获取标记点所有出现的日期
RoadbookApp.prototype.getMarkerAllDates = function(marker) {
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
};

// 获取日期键（YYYY-MM-DD格式）
RoadbookApp.prototype.getDateKey = function(dateTimeString) {
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
};

// 格式化日期标题
RoadbookApp.prototype.formatDateHeader = function(dateKey) {
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
};

// 获取星期几的中文名称
RoadbookApp.prototype.getWeekdayName = function(day) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return weekdays[day];
};

// 格式化时间（只在小时或分钟不为0时显示）
RoadbookApp.prototype.formatTime = function(dateTimeString) {
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
};

RoadbookApp.prototype.filterByDate = function(date) {
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
};

// 显示筛选模式提示
RoadbookApp.prototype.showFilterModeIndicator = function(date) {
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
};

// 绑定退出筛选模式的事件
RoadbookApp.prototype.bindFilterExitEvents = function() {
    // 点击地图退出筛选模式
    this.map.on('click', this.exitFilterModeHandler, this);

    // ESC键退出筛选模式
    if (!this.boundExitFilterModeKeyHandler) {
        this.boundExitFilterModeKeyHandler = this.exitFilterModeKeyHandler.bind(this);
    }
    document.addEventListener('keydown', this.boundExitFilterModeKeyHandler, true);

    // 点击任意按钮退出筛选模式
    if (!this.boundExitFilterModeClickHandler) {
        this.boundExitFilterModeClickHandler = this.exitFilterModeClickHandler.bind(this);
    }
    document.querySelectorAll('.btn').forEach(btn => {
        btn.addEventListener('click', this.boundExitFilterModeClickHandler, true);
    });
};

// 显示日期备注便签
RoadbookApp.prototype.showDateNotesSticky = function(date) {
    const sticky = document.getElementById('dateNotesSticky');
    const dateElement = document.getElementById('dateNotesDate');
    const contentElement = document.getElementById('dateNotesContent');

    if (sticky && dateElement && contentElement) {
        // 设置日期标题
        dateElement.textContent = this.formatDateHeader(date);

        // Persist current shown date so we can refresh it later
        sticky.dataset.date = date;

        // 获取日期备注
        const notes = this.getDateNotes(date);
        contentElement.innerHTML = this.convertMarkdownLinksToHtml(notes || '暂无备注');

        // 添加事件监听器，防止链接点击退出聚焦模式
        contentElement.addEventListener('click', (e) => {
            // 检查点击的元素是否是链接 (<a> 标签)
            if (e.target.tagName === 'A' && e.target.closest('#dateNotesContent')) {
                e.stopPropagation(); // 停止事件传播
            }
        });
        // 显示便签
        sticky.style.display = 'flex';

        // 阻止滚动事件冒泡到地图，防止在备注内容区域滚动时影响地图
        contentElement.addEventListener('wheel', function (e) {
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
};

// 隐藏日期备注便签
RoadbookApp.prototype.hideDateNotesSticky = function() {
    const sticky = document.getElementById('dateNotesSticky');
    if (sticky) {
        sticky.style.display = 'none';
    }
};

// 退出筛选模式的处理器
RoadbookApp.prototype.exitFilterModeHandler = function(e) {
    if (e.originalEvent) {
        this.exitFilterMode(false); // 点击地图退出筛选模式时不自动调整视图
    }
};

RoadbookApp.prototype.exitFilterModeKeyHandler = function(e) {
    if (e.key === 'Escape') {
        this.exitFilterMode(); // ESC键退出筛选模式时自动调整视图
    }
};

RoadbookApp.prototype.exitFilterModeClickHandler = function(e) {
    // 筛选模式下，日期详情面板内的按钮（如添加消费、扩大编辑等）不应该触发"退出筛选模式"
    if (e && e.target && typeof e.target.closest === 'function') {
        if (e.target.closest('#dateDetailPanel') || e.target.closest('#dateNotesSticky') || e.target.closest('#dateRangePicker') || e.target.closest('#expandModal')) {
            return;
        }
    }
    this.exitFilterMode(); // 按钮点击退出筛选模式时自动调整视图
};

// 退出筛选模式
RoadbookApp.prototype.exitFilterMode = function(shouldFitView = true) {
    if (!this.filterMode) return;

    console.log('退出日期筛选模式');

    // 如果日期详情面板是打开的，手动保存内容并关闭面板（防止递归调用）
    const dateNotesInput = document.getElementById('dateNotesInput');
    if (dateNotesInput && this.currentDate) {
        // 使用封装好的保存方法，确保数据结构正确
        this.saveDateNotes();

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
        headerTitle.textContent = 'RoadbookMaker';
        headerTitle.style.cursor = 'default';
        headerTitle.title = '';
        headerTitle.onclick = null;
    }

    // 移除事件监听
    this.map.off('click', this.exitFilterModeHandler, this);
    document.removeEventListener('keydown', this.boundExitFilterModeKeyHandler || this.exitFilterModeKeyHandler, true);
    document.querySelectorAll('.btn').forEach(btn => {
        btn.removeEventListener('click', this.boundExitFilterModeClickHandler || this.exitFilterModeClickHandler, true);
    });

    // 隐藏日期备注便签（自动关闭并保存）
    this.hideDateNotesSticky();

    // 退出筛选模式后根据参数决定是否调整视图
    if (shouldFitView) {
        setTimeout(() => {
            this.autoFitMapView();
        }, 100); // 稍微延时以确保所有元素都已重新添加到地图
    }
};

// 处理调整视窗按钮点击事件
RoadbookApp.prototype.handleFitViewClick = function() {
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
};

// 根据日期范围调整视图
RoadbookApp.prototype.fitViewByDateRange = function(startDateStr, endDateStr) {
    const startDate = new Date(startDateStr);
    startDate.setHours(0, 0, 0, 0); // 设置为当天的开始

    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999); // 设置为当天的结束

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        this.showSwalAlert('错误', '无效的日期格式。', 'error');
        return;
    }

    if (startDate > endDate) {
        this.showSwalAlert('错误', '开始日期不能晚于结束日期。', 'error');
        return;
    }

    const filteredMarkers = this.markers.filter(marker => {
        const markerDates = (marker.dateTimes && marker.dateTimes.length > 0) ? marker.dateTimes : [marker.dateTime];
        return markerDates.some(dtStr => {
            if (!dtStr) return false;
            const dt = new Date(dtStr);
            return dt >= startDate && dt <= endDate;
        });
    });

    const filteredConnections = this.connections.filter(conn => {
        if (!conn.dateTime) return false;
        const connDate = new Date(conn.dateTime);
        return connDate >= startDate && connDate <= endDate;
    });

    if (filteredMarkers.length === 0 && filteredConnections.length === 0) {
        this.showSwalAlert('提示', '该日期范围内没有找到任何地点或路线。', 'info');
        return;
    }

    const bounds = L.latLngBounds();
    filteredMarkers.forEach(marker => bounds.extend(marker.position));
    filteredConnections.forEach(conn => bounds.extend(conn.polyline.getLatLngs()));

    if (bounds.isValid()) {
        this.map.fitBounds(bounds, {padding: [50, 50], maxZoom: 16, animate: true});
    }

    // 保存本次使用的日期范围
    this.lastDateRange = {start: startDateStr, end: endDateStr};
    this.saveToLocalStorage();
};

// 更新筛选模式下的标记点列表
RoadbookApp.prototype.updateMarkerListForFilter = function() {
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

            item.querySelector('.delete-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                const result = await this.showSwalConfirm('删除确认', `确定要删除标记点"${marker.title}"吗？`, '删除', '取消');
                if (result.isConfirmed) {
                    this.removeMarker(marker);
                }
            });

            listContainer.appendChild(item);
        });
    }
};

RoadbookApp.prototype.checkAndHandleFilterMode = function() {
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
};
