// app_sidebar.js - 侧边栏标记点列表方法

RoadbookApp.prototype.updateMarkerList = function() {
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
        });

        // 计算并显示总花费
        let totalCost = 0;
        const dailyExpenses = [];

        allDates.forEach(date => {
            const expenses = this.getDateExpenses(date);
            if (expenses && expenses.length > 0) {
                const dayCost = expenses.reduce((sum, item) => sum + (parseFloat(item.cost) || 0), 0);
                if (dayCost > 0) {
                    totalCost += dayCost;
                    dailyExpenses.push({date, cost: dayCost});
                }
            }
        });

        const totalContainer = document.getElementById('totalExpensesContainer');
        const totalAmount = document.getElementById('totalExpensesAmount');

        if (totalContainer && totalAmount) {
            if (totalCost > 0) {
                totalContainer.style.display = 'flex';
                totalAmount.textContent = `¥${totalCost.toFixed(2)}`;

                // 绑定鼠标悬停事件显示明细
                totalContainer.onmouseover = () => {
                    let tooltip = document.getElementById('expenses-tooltip');
                    if (!tooltip) {
                        tooltip = document.createElement('div');
                        tooltip.id = 'expenses-tooltip';
                        tooltip.style.position = 'fixed';
                        tooltip.style.zIndex = '10000';
                        tooltip.style.pointerEvents = 'none';
                        tooltip.style.padding = '10px';
                        tooltip.style.borderRadius = '4px';
                        tooltip.style.fontSize = '12px';
                        tooltip.style.minWidth = '180px';
                        document.body.appendChild(tooltip);
                    }

                    let tooltipContent = '<div class="expenses-tooltip-header">每日消费明细</div>';
                    if (dailyExpenses.length > 0) {
                        dailyExpenses.forEach(item => {
                            tooltipContent += `<div class="expenses-tooltip-item">
                                <span>${this.formatDateHeader(item.date)}:</span>
                                <span class="expenses-tooltip-cost">¥${item.cost.toFixed(2)}</span>
                            </div>`;
                        });
                        tooltipContent += `<div class="expenses-tooltip-footer">
                            <span>总计:</span>
                            <span class="expenses-tooltip-total">¥${totalCost.toFixed(2)}</span>
                        </div>`;
                    } else {
                        tooltipContent += '<div>无消费记录</div>';
                    }

                    tooltip.innerHTML = tooltipContent;
                    tooltip.style.display = 'block';

                    const rect = totalContainer.getBoundingClientRect();
                    tooltip.style.left = rect.left + 'px';
                    tooltip.style.top = (rect.top - tooltip.offsetHeight - 5) + 'px';
                };

                totalContainer.onmousemove = () => {
                    const tooltip = document.getElementById('expenses-tooltip');
                    if (tooltip && tooltip.style.display !== 'none') {
                        // 稍微跟随鼠标，但保持在上方
                        // tooltip.style.left = (e.clientX + 10) + 'px';
                        // tooltip.style.top = (e.clientY - tooltip.offsetHeight - 10) + 'px';
                    }
                };

                totalContainer.onmouseout = () => {
                    const tooltip = document.getElementById('expenses-tooltip');
                    if (tooltip) {
                        tooltip.style.display = 'none';
                    }
                };
            } else {
                totalContainer.style.display = 'none';
            }
        }
    };
