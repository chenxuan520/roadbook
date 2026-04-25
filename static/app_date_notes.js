// app_date_notes.js - 日期备注和费用相关方法

RoadbookApp.prototype.showDateDetail = function(date) {
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

    // 渲染消费列表
    this.renderDateExpenses(date);

    // 隐藏其他详情面板，显示日期详情面板
    const markerDetailPanel = document.getElementById('markerDetailPanel');
    const connectionDetailPanel = document.getElementById('connectionDetailPanel');
    const dateDetailPanel = document.getElementById('dateDetailPanel');

    if (markerDetailPanel) markerDetailPanel.style.display = 'none';
    if (connectionDetailPanel) connectionDetailPanel.style.display = 'none';
    if (dateDetailPanel) dateDetailPanel.style.display = 'block';
};

// 获取指定日期的备注
RoadbookApp.prototype.getDateNotes = function(date) {
    if (!this.dateNotes) {
        this.dateNotes = {};
    }
    const entry = this.dateNotes[date];
    if (typeof entry === 'string') return entry;
    if (entry && entry.notes) return entry.notes;
    return '';
};

// 获取指定日期的消费列表
RoadbookApp.prototype.getDateExpenses = function(date) {
    if (!this.dateNotes) {
        this.dateNotes = {};
    }
    const entry = this.dateNotes[date];
    if (entry && typeof entry === 'object' && Array.isArray(entry.expenses)) {
        return entry.expenses;
    }
    return [];
};


// 更新消费记录
RoadbookApp.prototype.updateDateExpense = function(date, index, newCost, newRemark) {
    if (!this.dateNotes || !this.dateNotes[date]) return;

    const entry = this.dateNotes[date];
    if (typeof entry === 'object' && Array.isArray(entry.expenses)) {
        if (index >= 0 && index < entry.expenses.length) {
            entry.expenses[index].cost = parseFloat(newCost) || 0;
            entry.expenses[index].remark = newRemark || '';
            this.saveToLocalStorage();
        }
    }
};

RoadbookApp.prototype.renderDateExpenses = function(date) {
    const list = document.getElementById('dateExpensesList');
    if (!list) return;

    list.innerHTML = '';
    const expenses = this.getDateExpenses(date); // This returns a reference or copy? Let's assume array reference or we modify dateNotes directly

    // Need to ensure we're getting fresh data each render
    // Actually getDateExpenses returns entry.expenses which is a reference to the array inside dateNotes[date]

    if (expenses.length === 0) {
        list.innerHTML = '<li style="color: #999; font-size: 0.9em; text-align: center; padding: 5px;">暂无消费记录</li>';
    } else {
        expenses.forEach((expense, index) => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '5px 0';
            li.style.borderBottom = '1px solid #eee';
            // Add cursor pointer to indicate interactivity
            li.style.cursor = 'pointer';
            li.title = '双击编辑';

            // Store data for edit
            li.dataset.index = index;
            li.dataset.cost = expense.cost;
            li.dataset.remark = expense.remark || '';

            li.innerHTML = `
                    <div class="expense-display" style="flex: 1; display: flex; align-items: center; gap: 10px;">
                        <span class="expense-cost" style="font-weight: bold; color: #FF5722;">¥${expense.cost}</span>
                        <span class="expense-remark" style="color: #666; font-size: 0.9em;">${expense.remark || '无备注'}</span>
                    </div>
                    <div class="expense-edit-form" style="display: none; flex: 1; gap: 5px; align-items: center;">
                        <input type="number" class="edit-cost" value="${expense.cost}" step="0.01" style="width: 80px; padding: 2px;">
                        <input type="text" class="edit-remark" value="${expense.remark || ''}" placeholder="备注" style="flex: 1; padding: 2px;">
                        <button class="save-edit-btn" style="background: #4caf50; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 2px 8px;">🆗</button>
                        <button class="cancel-edit-btn" style="background: #9e9e9e; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 2px 8px;">✕</button>
                    </div>
                    <button class="delete-expense-btn" data-index="${index}" style="background: none; border: none; cursor: pointer; color: #999; padding: 0 5px;">✕</button>
                `;

            // Delete button
            li.querySelector('.delete-expense-btn').addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent triggering edit
                const idx = parseInt(e.target.dataset.index);
                this.removeDateExpense(date, idx);
                this.renderDateExpenses(date);
                this.updateMarkerList();
            });

            // Double click to edit
            li.addEventListener('dblclick', function () {
                const displayDiv = this.querySelector('.expense-display');
                const editDiv = this.querySelector('.expense-edit-form');
                const deleteBtn = this.querySelector('.delete-expense-btn');

                displayDiv.style.display = 'none';
                editDiv.style.display = 'flex';
                deleteBtn.style.display = 'none';
                this.style.cursor = 'default';
            });

            // Save edit
            li.querySelector('.save-edit-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                const costInput = li.querySelector('.edit-cost');
                const remarkInput = li.querySelector('.edit-remark');

                const newCost = costInput.value.trim();
                const newRemark = remarkInput.value.trim();

                if (!newCost) {
                    this.showSwalAlert('提示', '请输入金额', 'warning');
                    return;
                }

                this.updateDateExpense(date, index, newCost, newRemark);
                this.renderDateExpenses(date);
                this.updateMarkerList();
            });

            // Cancel edit
            li.querySelector('.cancel-edit-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.renderDateExpenses(date); // Simply re-render to reset state
            });

            // Support Enter key to save
            const handleEnter = (e) => {
                if (e.key === 'Enter') {
                    e.stopPropagation();
                    e.preventDefault();
                    li.querySelector('.save-edit-btn').click();
                }
            };
            li.querySelector('.edit-cost').addEventListener('keydown', handleEnter);
            li.querySelector('.edit-remark').addEventListener('keydown', handleEnter);

            list.appendChild(li);
        });
    }
};


RoadbookApp.prototype.addCurrentDateExpense = function() {
    if (!this.currentDate) return;

    const costInput = document.getElementById('expenseCostInput');
    const remarkInput = document.getElementById('expenseRemarkInput');

    if (!costInput || !remarkInput) return;

    const cost = costInput.value.trim();
    const remark = remarkInput.value.trim();

    if (!cost) {
        this.showSwalAlert('提示', '请输入金额', 'warning');
        return;
    }

    this.addDateExpense(this.currentDate, cost, remark);

    // Clear inputs
    costInput.value = '';
    remarkInput.value = '';

    // Re-render
    this.renderDateExpenses(this.currentDate);
    this.updateMarkerList(); // Update total in marker list
};

// 添加消费记录
RoadbookApp.prototype.addDateExpense = function(date, cost, remark) {
    if (!this.dateNotes) this.dateNotes = {};

    let entry = this.dateNotes[date];
    // 如果不存在或为字符串，转换为对象
    if (!entry || typeof entry === 'string') {
        entry = {
            notes: typeof entry === 'string' ? entry : '',
            expenses: []
        };
        this.dateNotes[date] = entry;
    } else if (!entry.expenses) {
        entry.expenses = [];
    }

    entry.expenses.push({
        cost: parseFloat(cost) || 0,
        remark: remark || ''
    });

    this.saveToLocalStorage();
    return entry.expenses;
};

// 删除消费记录
RoadbookApp.prototype.removeDateExpense = function(date, index) {
    if (!this.dateNotes || !this.dateNotes[date]) return;

    const entry = this.dateNotes[date];
    if (typeof entry === 'object' && Array.isArray(entry.expenses)) {
        if (index >= 0 && index < entry.expenses.length) {
            entry.expenses.splice(index, 1);
            this.saveToLocalStorage();
        }
    }
};

// 保存日期备注
RoadbookApp.prototype.saveDateNotes = function() {
    const dateNotesInput = document.getElementById('dateNotesInput');
    if (!dateNotesInput || !this.currentDate) return;

    if (!this.dateNotes) {
        this.dateNotes = {};
    }

    const notes = dateNotesInput.value.trim();
    let entry = this.dateNotes[this.currentDate];

    // 升级数据结构为对象，如果它还不是对象
    if (typeof entry === 'string') {
        this.dateNotes[this.currentDate] = {
            notes: notes,
            expenses: []
        };
    } else if (entry && typeof entry === 'object') {
        entry.notes = notes;
    } else {
        // 不存在，创建新对象
        this.dateNotes[this.currentDate] = {
            notes: notes,
            expenses: []
        };
    }

    // 保存到本地存储
    this.saveToLocalStorage();

    // 为实时保存而注释掉以下代码
    /*
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
    */
};

RoadbookApp.prototype.closeDateDetail = function() {
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
};
