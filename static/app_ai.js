// app_ai.js - AI 助手接口方法

RoadbookApp.prototype.aiAddMarker = function(title, lat, lng, id = null, dateTime = null) {
    console.log(`aiAddMarker called: title="${title}", lat=${lat} (${typeof lat}), lng=${lng} (${typeof lng}), id=${id}`);

    // Convert to number if they are strings, handle potential whitespace
    let parsedLat = lat;
    let parsedLng = lng;

    if (typeof lat === 'string') {
        parsedLat = parseFloat(lat.trim());
    }
    if (typeof lng === 'string') {
        parsedLng = parseFloat(lng.trim());
    }

    if (isNaN(parsedLat) || isNaN(parsedLng)) {
        console.error('Invalid coordinates for aiAddMarker:', lat, lng);
        return null;
    }

    // Range check (lat/lng)
    if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
        console.error('Out of range coordinates for aiAddMarker:', parsedLat, parsedLng);
        return null;
    }

    // Use provided ID or generate one
    let markerId = id;
    if (!markerId || this.markers.find(m => m.id === markerId)) {
        // If ID is missing or conflicts, generate a new one
        if (id) console.warn(`AI provided ID ${id} conflicts or is invalid, generating new ID`);
        markerId = Date.now() + Math.floor(Math.random() * 10000);
    }

    // Use createMarkerEntity to create the marker and bind events
    const markerData = this.createMarkerEntity(parsedLat, parsedLng, title, markerId, null, dateTime);

    this.markers.push(markerData);
    this.updateMarkerList();

    // Add to history
    this.addHistory('addMarker', {
        id: markerData.id,
        position: markerData.position,
        title: markerData.title,
        icon: markerData.icon,
        createdAt: markerData.createdAt,
        dateTimes: markerData.dateTimes,
        dateTime: markerData.dateTime
    });

    this.saveToLocalStorage();
    return markerData;
};

// AI Helper: Connect markers by ID
// 确保标记点包含指定的时间点（或时间数组）
RoadbookApp.prototype.ensureMarkerDateTime = function(marker, dateTime) {
    if (!marker || !dateTime) return false;

    let changed = false;

    // 规范化输入为数组
    const newTimes = Array.isArray(dateTime) ? dateTime : [dateTime];
    if (newTimes.length === 0) return false;

    // 初始化 dateTimes 数组
    if (!marker.dateTimes) {
        marker.dateTimes = [];
        // 如果存在旧的单个时间点，先迁移过来
        if (marker.dateTime) {
            marker.dateTimes.push(marker.dateTime);
        }
        changed = true;
    }

    // 添加新时间点（去重且同一天只能有一个时间点）
    newTimes.forEach(time => {
        if (!time) return;

        // 检查该时间点是否已存在（完全相同）
        if (marker.dateTimes.includes(time)) return;

        // 检查该日期是否已存在时间点
        const dateKey = this.getDateKey(time);
        const hasDate = marker.dateTimes.some(existingTime => this.getDateKey(existingTime) === dateKey);

        // 只有当该日期没有时间点时才添加（保留最早添加的那个，或者手动操作时保留旧的）
        // 这里的逻辑是：如果日期已存在，则忽略新时间点，这符合手动操作的习惯（修改连接线时间不应覆盖该点已有的时间规划，除非用户明确去修改点的时间）
        // 同时对 AI 也是一种保护，防止在同一天生成冲突的时间点
        if (!hasDate) {
            marker.dateTimes.push(time);
            changed = true;
        } else {
            console.log(`跳过添加时间点 ${time}，因为该日期 (${dateKey}) 已存在时间安排`);
        }
    });

    if (changed) {
        // 排序时间点
        marker.dateTimes.sort();

        // 如果 legacy dateTime 字段为空，或者它是 dateTimes 中的一个，更新它为第一个时间点
        // 这里我们保持 dateTime 字段与 dateTimes[0] 同步，或者是保持原样？
        // 通常最好保持 dateTime 字段有值，以兼容旧代码
        if (!marker.dateTime || marker.dateTimes.length > 0) {
            marker.dateTime = marker.dateTimes[0];
        }
    }

    return changed;
};

RoadbookApp.prototype.aiConnectMarkers = function(startId, endId, transportType = 'car', dateTime = null) {
    // 交通方式白名单校验（AI 可能生成非法值，如 taxi）
    const allowedTransportTypes = new Set(['car', 'walk', 'train', 'plane', 'subway', 'bus', 'cruise']);
    const normalizedTransport = (transportType === null || transportType === undefined)
        ? 'car'
        : String(transportType).trim().toLowerCase();
    if (!allowedTransportTypes.has(normalizedTransport)) {
        console.error('Invalid transport type for aiConnectMarkers:', transportType);
        return false;
    }

    // 禁止自己连接自己
    if (startId === endId) {
        console.error('Invalid marker IDs for aiConnectMarkers: Start ID and End ID are the same.', startId);
        return false;
    }

    // De-dup: if the directed edge already exists, do nothing.
    // (The AI assistant may retry the same action; skipping avoids duplicate lines.)
    if (this.connections && Array.isArray(this.connections)) {
        const exists = this.connections.some(c => c && c.startId === startId && c.endId === endId);
        if (exists) {
            console.info('aiConnectMarkers: connection already exists, skipping:', startId, '->', endId);
            return true;
        }
    }

    const startMarker = this.markers.find(m => m.id === startId);
    const endMarker = this.markers.find(m => m.id === endId);

    if (!startMarker || !endMarker) {
        console.error('Invalid marker IDs for aiConnectMarkers:', startId, endId, 'Start:', startMarker, 'End:', endMarker);
        return false;
    }

    this.createConnection(startMarker, endMarker, normalizedTransport, dateTime);

    // 如果提供了时间，自动添加到起始点和终点的 dateTimes 数组中
    if (dateTime) {
        let changed = false;

        if (this.ensureMarkerDateTime(startMarker, dateTime)) {
            changed = true;
        }
        if (this.ensureMarkerDateTime(endMarker, dateTime)) {
            changed = true;
        }

        if (changed) {
            // 触发更新
            this.updateMarkerList();
            this.saveToLocalStorage();
        }
    }

    return true;
};

// AI Helper: Remove marker by ID
RoadbookApp.prototype.aiRemoveMarker = function(id) {
    const marker = this.markers.find(m => m.id === id);
    if (!marker) {
        console.error('Invalid marker ID for aiRemoveMarker:', id);
        return false;
    }
    this.removeMarker(marker);
    return true;
};

// AI Helper: Update marker by ID
RoadbookApp.prototype.aiUpdateMarker = function(id, title, lat, lng, dateTime = null) {
    const marker = this.markers.find(m => m.id === id);
    if (!marker) {
        console.error('Invalid marker ID for aiUpdateMarker:', id);
        return false;
    }

    let updated = false;

    if (title) {
        marker.title = title;
        // Also update marker tooltip/popup if necessary, currently title is mostly used for list and export
        // Re-creating icon might be needed if title affects icon (e.g. "Hotel" vs "Park")
        const newIconConfig = this.getIconForName(title);
        // Only update icon if type changed or it's default
        if (marker.icon.type === 'default' || newIconConfig.type !== marker.icon.type) {
            marker.icon = newIconConfig;
            const newIcon = this.createMarkerIcon(newIconConfig, this.markers.indexOf(marker) + 1);
            marker.marker.setIcon(newIcon);
        }
        updated = true;
    }

    // dateTime supports string or string[]
    // IMPORTANT: Do NOT wipe existing times when input is invalid.
    if (dateTime !== null && dateTime !== undefined) {
        const normalizeRoadbookDateTime = (dt) => {
            if (typeof dt !== 'string') return null;
            const s = dt.trim();
            if (!s) return null;

            // YYYY-MM-DD -> YYYY-MM-DD 00:00:00
            const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (dateOnly) {
                return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]} 00:00:00`;
            }

            // YYYY-MM-DD HH:MM:SS or YYYY-MM-DDTHH:MM:SS
            const dateTimeFull = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
            if (dateTimeFull) {
                return `${dateTimeFull[1]}-${dateTimeFull[2]}-${dateTimeFull[3]} ${dateTimeFull[4]}:${dateTimeFull[5]}:${dateTimeFull[6]}`;
            }

            return null;
        };

        const buildDateTimes = (input) => {
            const arr = Array.isArray(input) ? input : [input];
            const normalized = arr.map(normalizeRoadbookDateTime).filter(Boolean);
            if (normalized.length === 0) return null;

            // One time point per day: keep the earliest time of that day.
            const byDay = new Map();
            for (const dt of normalized) {
                const dayKey = dt.slice(0, 10); // YYYY-MM-DD
                const existing = byDay.get(dayKey);
                if (!existing || dt < existing) {
                    byDay.set(dayKey, dt);
                }
            }

            return Array.from(byDay.values()).sort();
        };

        const newDateTimes = buildDateTimes(dateTime);
        if (newDateTimes) {
            marker.dateTimes = newDateTimes;
            marker.dateTime = newDateTimes[0];
            updated = true;
        } else {
            console.warn('aiUpdateMarker: invalid dateTime, keeping existing marker dates:', dateTime);
        }
    }

    // Convert to number if they are strings, handle potential whitespace
    let parsedLat = lat;
    let parsedLng = lng;

    if (typeof lat === 'string') {
        parsedLat = parseFloat(lat.trim());
    }
    if (typeof lng === 'string') {
        parsedLng = parseFloat(lng.trim());
    }

    if (!isNaN(parsedLat) && !isNaN(parsedLng) && typeof parsedLat === 'number' && typeof parsedLng === 'number' &&
        parsedLat >= -90 && parsedLat <= 90 && parsedLng >= -180 && parsedLng <= 180) {
        marker.position = [parsedLat, parsedLng];
        marker.marker.setLatLng([parsedLat, parsedLng]);

        // Record history? (Maybe skip for AI bulk ops to avoid clutter, or keep for undo)
        // For now, let's keep it simple and just update

        updated = true;
    }

    if (updated) {
        this.updateConnections(); // Update lines connected to this marker
        this.updateLabels();      // Update labels attached to this marker
        this.updateMarkerList();  // Refresh list
        this.saveToLocalStorage();
        return true;
    }
    return false;
};

// AI Helper: Remove connection by ID
RoadbookApp.prototype.aiRemoveConnection = function(id) {
    const connection = this.connections.find(c => c.id === id);
    if (!connection) {
        console.error('Invalid connection ID for aiRemoveConnection:', id);
        return false;
    }
    this.removeConnection(connection);
    return true;
};

// AI Helper: Update connection by ID
RoadbookApp.prototype.aiUpdateConnection = function(id, transportType, dateTime = null) {
    const connection = this.connections.find(c => c.id === id);
    if (!connection) {
        console.error('Invalid connection ID for aiUpdateConnection:', id);
        return false;
    }

    let updated = false;

    // 交通方式白名单校验（AI 可能生成非法值，如 taxi）
    const allowedTransportTypes = new Set(['car', 'walk', 'train', 'plane', 'subway', 'bus', 'cruise']);
    const normalizedTransport = (transportType === null || transportType === undefined)
        ? null
        : String(transportType).trim().toLowerCase();
    if (normalizedTransport && !allowedTransportTypes.has(normalizedTransport)) {
        console.error('Invalid transport type for aiUpdateConnection:', transportType);
        return false;
    }

    if (normalizedTransport && connection.transportType !== normalizedTransport) {
        connection.transportType = normalizedTransport;

        // Re-draw connection with new style
        // updateConnections() re-sets latlngs and arrow heads, but might not change color/style if polyline object is reused without style update
        // createConnection sets color on creation.
        // Let's update style manually here
        const newColor = this.getTransportColor(normalizedTransport);
        connection.polyline.setStyle({color: newColor});

        if (connection.endCircle) {
            connection.endCircle.setStyle({fillColor: newColor});
        }

        // Icon marker update
        if (connection.iconMarker) {
            const transportIcon = this.getTransportIcon(normalizedTransport);
            const iconHtml = `<div style="background-color: white; border: 2px solid ${newColor}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${transportIcon}</div>`;
            const newIcon = L.divIcon({
                className: 'transport-icon',
                html: iconHtml,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });
            connection.iconMarker.setIcon(newIcon);
        }

        updated = true;
    }

    if (dateTime) {
        connection.dateTime = dateTime;
        updated = true;
    }

    if (updated) {
        // Arrow head update is handled in updateConnections called below (it recreates arrow)
        this.updateConnections();
        this.saveToLocalStorage();
        return true;
    }
    return false;
};

// Check if date exists in itinerary (has markers or connections)
RoadbookApp.prototype.isDateInItinerary = function(date) {
    if (!date) return false;

    // Check if date already has notes
    if (this.dateNotes && this.dateNotes[date]) {
        return true;
    }

    // Check markers
    for (const marker of this.markers) {
        // Check single dateTime
        if (marker.dateTime && String(marker.dateTime).startsWith(date)) {
            return true;
        }
        // Check multiple dateTimes
        if (marker.dateTimes && Array.isArray(marker.dateTimes)) {
            if (marker.dateTimes.some(dt => dt && String(dt).startsWith(date))) {
                return true;
            }
        }
    }

    // Check connections
    for (const conn of this.connections) {
        if (conn.dateTime && String(conn.dateTime).startsWith(date)) {
            return true;
        }
    }

    return false;
};

// AI Helper: Update date note
RoadbookApp.prototype.aiUpdateDateNote = function(date, note) {
    // Normalize date key to avoid invisible chars / trailing spaces causing "saved but not found".
    // Accept inputs like "YYYY-MM-DD" or "YYYY-MM-DD ..." and normalize to "YYYY-MM-DD".
    const normalizeDateKey = (raw) => {
        if (raw === null || raw === undefined) return null;
        const s = String(raw).replace(/\u200b/g, '').trim();
        const m = s.match(/(\d{4}-\d{2}-\d{2})/);
        return m ? m[1] : null;
    };

    const dateKey = normalizeDateKey(date);
    if (!dateKey || !note) {
        console.error('Invalid date or note for aiUpdateDateNote');
        return false;
    }

    // Check if date exists in itinerary
    if (!this.isDateInItinerary(dateKey)) {
        console.warn(`Cannot update note for date ${dateKey}: Date not found in itinerary.`);
        return false;
    }

    if (!this.dateNotes) {
        this.dateNotes = {};
    }

    let entry = this.dateNotes[dateKey];

    // 升级数据结构为对象，如果它还不是对象
    if (typeof entry === 'string') {
        this.dateNotes[dateKey] = {
            notes: note,
            expenses: []
        };
    } else if (entry && typeof entry === 'object') {
        entry.notes = note;
    } else {
        // 不存在，创建新对象
        this.dateNotes[dateKey] = {
            notes: note,
            expenses: []
        };
    }

    this.saveToLocalStorage();
    // If the user is currently viewing this date (detail panel or sticky note), refresh UI immediately.
    this.refreshDateNotesUI(dateKey);
    return true;
};

// Refresh date notes UI for a given date (detail panel + sticky note)
RoadbookApp.prototype.refreshDateNotesUI = function(date) {
    if (!date) return;

    // 1) Date detail panel (textarea)
    if (this.currentDate === date) {
        const dateNotesInput = document.getElementById('dateNotesInput');
        if (dateNotesInput) {
            dateNotesInput.value = this.getDateNotes(date) || '';
        }
    }

    // 2) Sticky note shown in filter mode
    const sticky = document.getElementById('dateNotesSticky');
    const contentElement = document.getElementById('dateNotesContent');
    if (sticky && contentElement && sticky.style.display !== 'none') {
        const shownDate = sticky.dataset ? sticky.dataset.date : '';
        if (shownDate === date) {
            const notes = this.getDateNotes(date);
            contentElement.innerHTML = this.convertMarkdownLinksToHtml(notes || '暂无备注');
        }
    }
};
