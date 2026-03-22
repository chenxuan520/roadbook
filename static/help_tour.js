// RoadbookMaker 新手引导（轻量版，无第三方依赖）
// 启动条件：
// 1) URL 参数 help=true 强制开启
// 2) 否则：仅在“首次打开”（初始 localStorage 为空）且没有 help=false 且未被 skip/done 时自动开启
// 支持：上一步 / 下一步 / 跳过（Esc）

(function () {
    'use strict';

    const TOUR_STORAGE_KEY = 'roadbook_help_tour_v1';
    const OVERLAY_ID = 'rb-help-tour-overlay';

    // 日程分组展开状态快照（用于“演示展开后再恢复原样”）
    let firstDateGroupInitiallyExpanded = null;
    function resetDateGroupSnapshot() {
        firstDateGroupInitiallyExpanded = null;
    }

    // 注意：script.js 会在 DOMContentLoaded 时写入默认设置（如 roadbook-theme）。
    // 为确保“首次打开”判断不被本次加载过程污染，这里在 help_tour.js 加载时就拍快照。
    const initialStorageSnapshot = (() => {
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k) keys.push(k);
            }
            return {
                length: localStorage.length,
                keys
            };
        } catch {
            return {
                length: -1,
                keys: []
            };
        }
    })();

    function getHelpParam() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const v = (params.get('help') || '').trim().toLowerCase();
            if (v === 'true' || v === '1' || v === 'yes') return 'force';
            if (v === 'false' || v === '0' || v === 'no') return 'disable';
            return null;
        } catch {
            return null;
        }
    }

    function hasShareFlow() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            return Boolean(params.get('shareID'));
        } catch {
            return false;
        }
    }

    function isFirstOpenAtLoad() {
        // 首次打开定义：该次页面加载开始时，本域 localStorage 完全为空。
        // 二次打开（哪怕只留了设置）也不自动弹出。
        return initialStorageSnapshot.length === 0;
    }

    function isAppMapEmptyNow() {
        try {
            const markersLen = (window.app && Array.isArray(window.app.markers)) ? window.app.markers.length : 0;
            const connectionsLen = (window.app && Array.isArray(window.app.connections)) ? window.app.connections.length : 0;
            return markersLen === 0 && connectionsLen === 0;
        } catch {
            return true;
        }
    }

    function getTourState() {
        try {
            return (localStorage.getItem(TOUR_STORAGE_KEY) || '').trim();
        } catch {
            return '';
        }
    }

    function setTourState(state) {
        try {
            localStorage.setItem(TOUR_STORAGE_KEY, state);
        } catch {
            // ignore
        }
    }

    function injectStylesOnce() {
        if (document.getElementById('rb-help-tour-style')) return;
        const style = document.createElement('style');
        style.id = 'rb-help-tour-style';
        style.textContent = `
            #${OVERLAY_ID} {
                position: fixed;
                inset: 0;
                z-index: 99999;
                pointer-events: auto;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', sans-serif;
            }
            #${OVERLAY_ID} * { box-sizing: border-box; }
            #${OVERLAY_ID} .rb-tour-backdrop {
                position: absolute;
                inset: 0;
                /* 默认由 JS 在“有高亮目标/无目标”之间动态切换 */
                background: transparent;
            }
            #${OVERLAY_ID} .rb-tour-highlight {
                position: absolute;
                border: 2px solid rgba(255,255,255,0.95);
                border-radius: 12px;
                box-shadow: 0 0 0 9999px rgba(0,0,0,0.55);
                background: transparent;
                pointer-events: none;
                transition: all 160ms ease;
            }
            #${OVERLAY_ID} .rb-tour-tooltip {
                position: absolute;
                width: min(360px, calc(100vw - 24px));
                background: rgba(255,255,255,0.98);
                color: #1f2937;
                border-radius: 12px;
                padding: 12px 12px 10px;
                box-shadow: 0 12px 40px rgba(0,0,0,0.35);
            }
            #${OVERLAY_ID} .rb-tour-tooltip::before {
                content: '';
                position: absolute;
                width: 0;
                height: 0;
            }
            /* 小箭头（指向高亮区域） */
            #${OVERLAY_ID} .rb-tour-tooltip[data-placement="bottom"]::before {
                top: -8px;
                left: var(--rb-arrow-left, 24px);
                border-left: 8px solid transparent;
                border-right: 8px solid transparent;
                border-bottom: 8px solid rgba(255,255,255,0.98);
            }
            #${OVERLAY_ID} .rb-tour-tooltip[data-placement="top"]::before {
                bottom: -8px;
                left: var(--rb-arrow-left, 24px);
                border-left: 8px solid transparent;
                border-right: 8px solid transparent;
                border-top: 8px solid rgba(255,255,255,0.98);
            }
            #${OVERLAY_ID} .rb-tour-tooltip[data-placement="right"]::before {
                left: -8px;
                top: var(--rb-arrow-top, 18px);
                border-top: 8px solid transparent;
                border-bottom: 8px solid transparent;
                border-right: 8px solid rgba(255,255,255,0.98);
            }
            #${OVERLAY_ID} .rb-tour-tooltip[data-placement="left"]::before {
                right: -8px;
                top: var(--rb-arrow-top, 18px);
                border-top: 8px solid transparent;
                border-bottom: 8px solid transparent;
                border-left: 8px solid rgba(255,255,255,0.98);
            }
            #${OVERLAY_ID} .rb-tour-tooltip[data-placement="center"]::before {
                display: none;
            }
            body.dark-mode #${OVERLAY_ID} .rb-tour-tooltip {
                background: rgba(24,24,27,0.98);
                color: #e5e7eb;
                box-shadow: 0 12px 40px rgba(0,0,0,0.55);
            }
            body.dark-mode #${OVERLAY_ID} .rb-tour-tooltip[data-placement="bottom"]::before { border-bottom-color: rgba(24,24,27,0.98); }
            body.dark-mode #${OVERLAY_ID} .rb-tour-tooltip[data-placement="top"]::before { border-top-color: rgba(24,24,27,0.98); }
            body.dark-mode #${OVERLAY_ID} .rb-tour-tooltip[data-placement="right"]::before { border-right-color: rgba(24,24,27,0.98); }
            body.dark-mode #${OVERLAY_ID} .rb-tour-tooltip[data-placement="left"]::before { border-left-color: rgba(24,24,27,0.98); }
            #${OVERLAY_ID} .rb-tour-title {
                font-size: 14px;
                font-weight: 700;
                margin: 0 0 6px;
            }
            #${OVERLAY_ID} .rb-tour-body {
                font-size: 13px;
                line-height: 1.5;
                margin: 0 0 10px;
            }
            #${OVERLAY_ID} .rb-tour-footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }
            #${OVERLAY_ID} .rb-tour-progress {
                font-size: 12px;
                opacity: 0.75;
                user-select: none;
            }
            #${OVERLAY_ID} .rb-tour-actions {
                display: flex;
                gap: 8px;
            }
            #${OVERLAY_ID} .rb-tour-btn {
                border: none;
                border-radius: 10px;
                padding: 7px 10px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 700;
            }
            #${OVERLAY_ID} .rb-tour-btn-primary {
                background: #667eea;
                color: #fff;
            }
            #${OVERLAY_ID} .rb-tour-btn-secondary {
                background: rgba(148,163,184,0.25);
                color: inherit;
            }
            #${OVERLAY_ID} .rb-tour-btn-ghost {
                background: transparent;
                color: inherit;
                opacity: 0.85;
            }
            #${OVERLAY_ID} .rb-tour-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
    }

    function isElementVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    class RoadbookHelpTour {
        constructor(steps) {
            this.steps = Array.isArray(steps) ? steps : [];
            this.index = 0;
            this.overlay = null;
            this.backdrop = null;
            this.highlight = null;
            this.tooltip = null;
            this.prevOverflow = null;
            this.onKeyDown = this.onKeyDown.bind(this);
            this.onResize = this.onResize.bind(this);
            this.autoNextTimer = null;
            this.autoNextStopAt = 0;
            this.autoNextNotBefore = 0;
            this.afterEnterRanIndex = -1;

            // 避免自动跳转的 setTimeout 在用户手动点击后“补刀”导致连跳
            this.pendingNextTimeout = null;

            // Leaflet map 事件（用于在 flyTo/zoom 时保持高亮准确）
            this.leafletMap = null;
            this.onLeafletViewChanged = null;
        }

        start(startIndex = 0) {
            if (document.getElementById(OVERLAY_ID)) return;
            if (!this.steps.length) return;

            injectStylesOnce();

            this.index = clamp(startIndex, 0, this.steps.length - 1);
            this.prevOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';

            this.overlay = document.createElement('div');
            this.overlay.id = OVERLAY_ID;

            this.backdrop = document.createElement('div');
            this.backdrop.className = 'rb-tour-backdrop';

            // 点击空白遮罩 = 下一步（模拟常见产品新手引导交互）
            this.backdrop.addEventListener('click', (e) => {
                try {
                    if (e && typeof e.preventDefault === 'function') e.preventDefault();
                    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                } catch {
                    // ignore
                }
                this.next();
            });

            this.highlight = document.createElement('div');
            this.highlight.className = 'rb-tour-highlight';

            this.tooltip = document.createElement('div');
            this.tooltip.className = 'rb-tour-tooltip';

            // 避免点击 tooltip 内容时触发“空白下一步”
            this.tooltip.addEventListener('click', (e) => {
                try {
                    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                } catch {
                    // ignore
                }
            });

            this.overlay.appendChild(this.backdrop);
            this.overlay.appendChild(this.highlight);
            this.overlay.appendChild(this.tooltip);
            document.body.appendChild(this.overlay);

            window.addEventListener('keydown', this.onKeyDown, true);
            window.addEventListener('resize', this.onResize);
            window.addEventListener('scroll', this.onResize, true);

            // 监听 Leaflet 地图视图变化：flyTo / zoom 动画过程中 DOM 会移动，必须持续重算高亮位置
            try {
                const map = window.app && window.app.map;
                if (map && typeof map.on === 'function' && typeof map.off === 'function') {
                    this.leafletMap = map;
                    this.onLeafletViewChanged = () => {
                        // RAF 合并频繁事件，避免抖动
                        requestAnimationFrame(() => this.onResize());
                    };
                    map.on('move', this.onLeafletViewChanged);
                    map.on('zoom', this.onLeafletViewChanged);
                    map.on('resize', this.onLeafletViewChanged);
                    map.on('moveend', this.onLeafletViewChanged);
                    map.on('zoomend', this.onLeafletViewChanged);
                    map.on('viewreset', this.onLeafletViewChanged);
                }
            } catch {
                // ignore
            }

            this.render();
        }

        stop(state) {
            try {
                window.removeEventListener('keydown', this.onKeyDown, true);
                window.removeEventListener('resize', this.onResize);
                window.removeEventListener('scroll', this.onResize, true);
            } catch {
                // ignore
            }

            // 清理 Leaflet map 监听
            try {
                if (this.leafletMap && this.onLeafletViewChanged && typeof this.leafletMap.off === 'function') {
                    this.leafletMap.off('move', this.onLeafletViewChanged);
                    this.leafletMap.off('zoom', this.onLeafletViewChanged);
                    this.leafletMap.off('resize', this.onLeafletViewChanged);
                    this.leafletMap.off('moveend', this.onLeafletViewChanged);
                    this.leafletMap.off('zoomend', this.onLeafletViewChanged);
                    this.leafletMap.off('viewreset', this.onLeafletViewChanged);
                }
            } catch {
                // ignore
            }
            this.leafletMap = null;
            this.onLeafletViewChanged = null;

            if (this.autoNextTimer) {
                clearInterval(this.autoNextTimer);
                this.autoNextTimer = null;
            }

            if (this.pendingNextTimeout) {
                clearTimeout(this.pendingNextTimeout);
                this.pendingNextTimeout = null;
            }

            if (this.overlay && this.overlay.parentNode) {
                this.overlay.parentNode.removeChild(this.overlay);
            }
            this.overlay = null;
            this.backdrop = null;
            this.highlight = null;
            this.tooltip = null;

            document.body.style.overflow = this.prevOverflow || '';

            // 恢复界面：关闭任何详情面板，回到“列表/地图”默认状态
            try {
                closeAnyDetailPanels();
            } catch {
                // ignore
            }

            // 如果演示过程把日程分组展开了，尽量恢复成演示前的状态
            try {
                restoreFirstDateGroupExpansionIfNeeded();
            } catch {
                // ignore
            }

            // 重置日程展开快照
            try {
                resetDateGroupSnapshot();
            } catch {
                // ignore
            }

            if (state) setTourState(state);
        }

        onKeyDown(e) {
            if (!e) return;
            // 只在引导覆盖层存在时拦截
            if (!document.getElementById(OVERLAY_ID)) return;

            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.stop('skipped');
                return;
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                e.stopPropagation();
                this.prev();
                return;
            }
            if (e.key === 'ArrowRight' || e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                this.next();
            }
        }

        onResize() {
            // 重新定位当前步骤
            if (!document.getElementById(OVERLAY_ID)) return;
            this.position();
        }

        prev() {
            if (this.pendingNextTimeout) {
                clearTimeout(this.pendingNextTimeout);
                this.pendingNextTimeout = null;
            }
            if (this.index <= 0) return;
            this.index -= 1;
            this.render();
        }

        next() {
            if (this.pendingNextTimeout) {
                clearTimeout(this.pendingNextTimeout);
                this.pendingNextTimeout = null;
            }
            if (this.index >= this.steps.length - 1) {
                this.stop('done');
                return;
            }
            this.index += 1;
            this.render();
        }

        scheduleNext(delayMs, onlyIfIndexMatches) {
            if (this.pendingNextTimeout) {
                clearTimeout(this.pendingNextTimeout);
                this.pendingNextTimeout = null;
            }
            const expectedIndex = Number.isFinite(onlyIfIndexMatches) ? onlyIfIndexMatches : this.index;
            const d = Number.isFinite(delayMs) ? delayMs : 0;
            this.pendingNextTimeout = setTimeout(() => {
                this.pendingNextTimeout = null;
                // 如果用户在 delay 内已经手动切换了步骤，不再自动 next，避免“连跳”
                if (this.index !== expectedIndex) return;
                this.next();
            }, Math.max(0, d));
        }

        render() {
            const step = this.steps[this.index];
            if (!step) return;

            if (this.pendingNextTimeout) {
                clearTimeout(this.pendingNextTimeout);
                this.pendingNextTimeout = null;
            }

            // 每一步开始前，允许做一些准备动作（比如关闭面板，让用户必须点击）
            if (typeof step.beforeEnter === 'function') {
                try {
                    step.beforeEnter();
                } catch {
                    // ignore
                }
            }

            const isLast = this.index === this.steps.length - 1;
            const title = String(step.title || '');
            const content = String(step.content || '');

            this.tooltip.innerHTML = `
                <div class="rb-tour-title">${escapeHtml(title)}</div>
                <div class="rb-tour-body">${escapeHtml(content).replace(/\n/g, '<br>')}</div>
                <div class="rb-tour-footer">
                    <div class="rb-tour-progress">${this.index + 1} / ${this.steps.length}</div>
                    <div class="rb-tour-actions">
                        <button class="rb-tour-btn rb-tour-btn-ghost" data-action="skip">跳过</button>
                        <button class="rb-tour-btn rb-tour-btn-secondary" data-action="prev" ${this.index === 0 ? 'disabled' : ''}>上一步</button>
                        <button class="rb-tour-btn rb-tour-btn-primary" data-action="next">${isLast ? '完成' : '下一步'}</button>
                    </div>
                </div>
            `;

            const bind = (action, handler) => {
                const btn = this.tooltip.querySelector(`[data-action="${action}"]`);
                if (!btn) return;
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handler();
                });
            };
            bind('skip', () => this.stop('skipped'));
            bind('prev', () => this.prev());
            bind('next', () => this.next());

            // 渲染后定位
            requestAnimationFrame(() => {
                this.position();

                // 每个步骤仅执行一次 afterEnter（避免 resize / 重绘重复触发）
                if (this.afterEnterRanIndex !== this.index && typeof step.afterEnter === 'function') {
                    this.afterEnterRanIndex = this.index;
                    try {
                        step.afterEnter();
                    } catch {
                        // ignore
                    }
                }
            });

            // 可选：等待用户完成某个动作后自动进入下一步
            this.setupAutoNext(step);
        }

        setupAutoNext(step) {
            if (this.autoNextTimer) {
                clearInterval(this.autoNextTimer);
                this.autoNextTimer = null;
            }

            const cond = step && step.autoNextWhen;
            if (!cond) return;

            const minDelayMs = Number.isFinite(step.autoNextMinDelayMs) ? step.autoNextMinDelayMs : 0;
            this.autoNextNotBefore = Date.now() + Math.max(0, minDelayMs);

            const timeoutMs = Number.isFinite(step.autoNextTimeoutMs) ? step.autoNextTimeoutMs : 15000;
            this.autoNextStopAt = Date.now() + timeoutMs;

            this.autoNextTimer = setInterval(() => {
                try {
                    if (Date.now() > this.autoNextStopAt) {
                        clearInterval(this.autoNextTimer);
                        this.autoNextTimer = null;
                        return;
                    }

                    if (this.autoNextNotBefore && Date.now() < this.autoNextNotBefore) {
                        return;
                    }

                    const ok = (typeof cond === 'function') ? Boolean(cond()) : false;
                    if (!ok) return;

                    clearInterval(this.autoNextTimer);
                    this.autoNextTimer = null;
                    // 给 UI 一点时间稳定；但如果用户已经手动跳走，则不再“补刀”
                    this.scheduleNext(120, this.index);
                } catch {
                    // ignore
                }
            }, 200);
        }

        position() {
            const step = this.steps[this.index];
            if (!step) return;

            const selector = step.selector;
            const padding = Number.isFinite(step.padding) ? step.padding : 10;

            let targetEl = null;
            if (selector) {
                try {
                    targetEl = document.querySelector(selector);
                } catch {
                    targetEl = null;
                }
            }

            // 允许通过 getTargetElement 提供动态目标（例如 Leaflet 的 marker/path DOM）
            if (!targetEl && typeof step.getTargetElement === 'function') {
                try {
                    targetEl = step.getTargetElement();
                } catch {
                    targetEl = null;
                }
            }

            // 默认居中
            let rect = { left: window.innerWidth / 2 - 60, top: window.innerHeight / 2 - 30, width: 120, height: 60 };
            let hasTarget = false;
            if (targetEl && isElementVisible(targetEl)) {
                hasTarget = true;
                try {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                } catch {
                    // ignore
                }
                rect = targetEl.getBoundingClientRect();
            }

            const hlLeft = Math.round(rect.left - padding);
            const hlTop = Math.round(rect.top - padding);
            const hlWidth = Math.round(rect.width + padding * 2);
            const hlHeight = Math.round(rect.height + padding * 2);

            if (this.highlight) {
                if (hasTarget) {
                    this.highlight.style.display = 'block';
                    this.highlight.style.left = `${hlLeft}px`;
                    this.highlight.style.top = `${hlTop}px`;
                    this.highlight.style.width = `${hlWidth}px`;
                    this.highlight.style.height = `${hlHeight}px`;
                } else {
                    // 无目标元素：隐藏高亮框，让纯遮罩生效
                    this.highlight.style.display = 'none';
                }
            }

            // 遮罩策略：
            // - 有高亮目标：通过 highlight 的超大 box-shadow 来“打洞”，backdrop 置为透明，保证高亮区域亮度不变
            // - 无高亮目标：backdrop 使用半透明黑，作为全屏遮罩
            if (this.backdrop) {
                this.backdrop.style.background = hasTarget ? 'transparent' : 'rgba(0,0,0,0.55)';
            }

            // tooltip 定位
            const tipRect = this.tooltip.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            const midX = rect.left + rect.width / 2;
            const midY = rect.top + rect.height / 2;

            const align = (step.tooltipAlign === 'start' || step.tooltipAlign === 'end') ? step.tooltipAlign : 'center';
            const placementOrder = Array.isArray(step.tooltipPlacementOrder) ? step.tooltipPlacementOrder : null;
            const primaryPlacement = (typeof step.tooltipPlacement === 'string') ? step.tooltipPlacement : null;

            const placements = placementOrder && placementOrder.length
                ? placementOrder
                : (primaryPlacement ? [primaryPlacement, 'bottom', 'top', 'right', 'left', 'center'] : ['bottom', 'top', 'right', 'left', 'center']);

            const computeXForHorizontal = (placement) => {
                if (placement === 'right') return rect.left + rect.width + 14;
                if (placement === 'left') return rect.left - tipRect.width - 14;
                // top/bottom/center
                if (align === 'start') return rect.left;
                if (align === 'end') return rect.left + rect.width - tipRect.width;
                return midX - tipRect.width / 2;
            };

            const computeYForVertical = (placement) => {
                if (placement === 'bottom') return rect.top + rect.height + 14;
                if (placement === 'top') return rect.top - tipRect.height - 14;
                if (placement === 'right' || placement === 'left') return midY - tipRect.height / 2;
                // center
                return (vh - tipRect.height) / 2;
            };

            const candidates = placements.map((placement) => {
                return {
                    placement,
                    x: computeXForHorizontal(placement),
                    y: computeYForVertical(placement)
                };
            });

            // 选择策略：优先选择“需要最少修正（clamp 偏移最小）”的位置，
            // 避免像右上角按钮这类场景因为略微出界而退化到居中。
            let best = {
                x: (vw - tipRect.width) / 2,
                y: (vh - tipRect.height) / 2,
                score: 1e18,
                placement: 'center'
            };

            for (let i = 0; i < candidates.length; i++) {
                const c = candidates[i];
                const x = clamp(c.x, 12, vw - tipRect.width - 12);
                const y = clamp(c.y, 12, vh - tipRect.height - 12);

                const dx = Math.abs(x - c.x);
                const dy = Math.abs(y - c.y);
                // 主要评分：偏移越小越好
                // 次要评分：候选顺序（更偏好“下/上/右/左”的自然位置）
                const centerPenalty = (c.placement === 'center') ? 100000 : 0;
                const score = dx + dy + i * 0.01 + centerPenalty;

                if (score < best.score) {
                    best = { x, y, score, placement: c.placement };
                }
            }

            const finalX = best.x;
            const finalY = best.y;

            // 设置 placement + 箭头位置
            if (this.tooltip) {
                this.tooltip.setAttribute('data-placement', best.placement || 'center');
                // 箭头相对 tooltip 的位置（尽量指向高亮中心）
                const arrowLeft = clamp(midX - finalX, 18, tipRect.width - 18);
                const arrowTop = clamp(midY - finalY, 14, tipRect.height - 14);
                this.tooltip.style.setProperty('--rb-arrow-left', `${Math.round(arrowLeft)}px`);
                this.tooltip.style.setProperty('--rb-arrow-top', `${Math.round(arrowTop)}px`);
            }

            this.tooltip.style.left = `${Math.round(finalX)}px`;
            this.tooltip.style.top = `${Math.round(finalY)}px`;
        }
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function closeAnyDetailPanels() {
        try {
            if (window.app) {
                if (typeof window.app.hideMarkerDetail === 'function') window.app.hideMarkerDetail();
                if (typeof window.app.hideConnectionDetail === 'function') window.app.hideConnectionDetail();
                if (typeof window.app.closeDateDetail === 'function') window.app.closeDateDetail();

                // 如果当前处于“按日期筛选模式”，退出回到完整日程列表
                // shouldFitView=false：避免退出时自动调整视窗导致引导高亮跳动
                if (typeof window.app.exitFilterMode === 'function') window.app.exitFilterMode(false);
            }
        } catch {
            // ignore
        }
    }

    function getFirstMarkerElement() {
        try {
            const m = window.app && Array.isArray(window.app.markers) ? window.app.markers[0] : null;
            if (!m || !m.marker || typeof m.marker.getElement !== 'function') return null;
            return m.marker.getElement();
        } catch {
            return null;
        }
    }

    function getFirstConnectionElement() {
        try {
            const c = window.app && Array.isArray(window.app.connections) ? window.app.connections[0] : null;
            if (!c) return null;
            if (c.polyline && typeof c.polyline.getElement === 'function') {
                const el = c.polyline.getElement();
                if (el) return el;
            }
            if (c.iconMarker && typeof c.iconMarker.getElement === 'function') {
                return c.iconMarker.getElement();
            }
            return null;
        } catch {
            return null;
        }
    }

    function openFirstMarkerDetailAndFocus() {
        try {
            if (!window.app || !window.app.map || !Array.isArray(window.app.markers) || window.app.markers.length === 0) return false;
            const m = window.app.markers[0];
            if (!m || !m.marker || typeof m.marker.getLatLng !== 'function') return false;

            const latlng = m.marker.getLatLng();
            const currentZoom = (typeof window.app.map.getZoom === 'function') ? window.app.map.getZoom() : 10;
            const targetZoom = Math.max(currentZoom, 13);

            try {
                if (typeof window.app.map.flyTo === 'function') {
                    window.app.map.flyTo(latlng, targetZoom, { animate: true, duration: 0.6 });
                } else if (typeof window.app.map.setView === 'function') {
                    window.app.map.setView(latlng, targetZoom);
                }
            } catch {
                // ignore
            }

            // 这相当于“点击点打开编辑面板”的效果（更稳定）
            if (typeof window.app.showMarkerDetail === 'function') {
                window.app.showMarkerDetail(m);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    function openFirstConnectionDetailAndFocus() {
        try {
            if (!window.app || !window.app.map || !Array.isArray(window.app.connections) || window.app.connections.length === 0) return false;
            const c = window.app.connections[0];
            if (!c) return false;

            let latlng = null;
            if (c.iconMarker && typeof c.iconMarker.getLatLng === 'function') {
                latlng = c.iconMarker.getLatLng();
            } else if (c.polyline && typeof c.polyline.getBounds === 'function') {
                const b = c.polyline.getBounds();
                if (b && typeof b.getCenter === 'function') latlng = b.getCenter();
            }

            if (latlng) {
                const currentZoom = (typeof window.app.map.getZoom === 'function') ? window.app.map.getZoom() : 10;
                const targetZoom = Math.max(currentZoom, 12);
                try {
                    if (typeof window.app.map.flyTo === 'function') {
                        window.app.map.flyTo(latlng, targetZoom, { animate: true, duration: 0.6 });
                    } else if (typeof window.app.map.setView === 'function') {
                        window.app.map.setView(latlng, targetZoom);
                    }
                } catch {
                    // ignore
                }
            }

            // 这相当于“点击连接线打开编辑面板”的效果（更稳定）
            if (typeof window.app.showConnectionDetail === 'function') {
                window.app.showConnectionDetail(c);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    function getFirstDateHeaderElement() {
        try {
            return document.querySelector('#markerList .date-group-header');
        } catch {
            return null;
        }
    }

    function getFirstDateExpandToggleElement() {
        try {
            return document.querySelector('#markerList .date-group-header .expand-toggle');
        } catch {
            return null;
        }
    }

    function isFirstDateGroupExpanded() {
        try {
            const header = getFirstDateHeaderElement();
            if (!header) return false;
            let el = header.nextElementSibling;
            while (el) {
                if (el.classList && el.classList.contains('date-group-header')) return false;
                if (el.classList && el.classList.contains('marker-item')) return true;
                el = el.nextElementSibling;
            }
            return false;
        } catch {
            return false;
        }
    }

    function ensureFirstDateGroupExpanded() {
        try {
            const expanded = isFirstDateGroupExpanded();
            if (firstDateGroupInitiallyExpanded === null) {
                firstDateGroupInitiallyExpanded = expanded;
            }
            if (expanded) return true;
            const toggle = getFirstDateExpandToggleElement();
            if (!toggle) return false;
            toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return true;
        } catch {
            return false;
        }
    }

    function restoreFirstDateGroupExpansionIfNeeded() {
        try {
            // 只有“原本是收起”的情况下，才在演示后自动折叠回去
            if (firstDateGroupInitiallyExpanded !== false) return false;
            if (!isFirstDateGroupExpanded()) return true;
            const toggle = getFirstDateExpandToggleElement();
            if (!toggle) return false;
            toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return true;
        } catch {
            return false;
        }
    }

    function getFirstMarkerInfoUnderFirstDateGroup() {
        try {
            const header = getFirstDateHeaderElement();
            if (!header) return null;

            let el = header.nextElementSibling;
            while (el) {
                if (el.classList && el.classList.contains('date-group-header')) return null;
                if (el.classList && el.classList.contains('marker-item')) {
                    const info = el.querySelector('.marker-info');
                    return info || el;
                }
                el = el.nextElementSibling;
            }
            return null;
        } catch {
            return null;
        }
    }

    function clickFirstMarkerInfoUnderFirstDateGroupToOpenMarkerDetail() {
        try {
            const info = getFirstMarkerInfoUnderFirstDateGroup();
            if (!info) return false;
            info.scrollIntoView({ block: 'nearest' });
            info.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return true;
        } catch {
            return false;
        }
    }

    function clickFirstDateHeaderToOpenDateDetail() {
        try {
            const header = getFirstDateHeaderElement();
            if (!header) return false;

            header.scrollIntoView({ block: 'nearest' });

            // 重要：点击 header 本身（非 expand-toggle），会走 filter + showDateDetail 的分支
            header.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return true;
        } catch {
            return false;
        }
    }

    function buildDefaultSteps(options = {}) {
        const hasExistingData = Boolean(options.hasExistingData);
        const demoCreated = Boolean(options.demoCreated);

        const markerClickStepTitle = hasExistingData ? '点击现有标记点编辑' : '点击示例标记点编辑';
        const connectionClickStepTitle = hasExistingData ? '点击现有连接线编辑' : '点击示例连接线编辑';

        const demoHint = demoCreated
            ? '\n提示：这是示例数据（两点一线），你可以继续在此基础上修改，或用“🗑️ 清空数据”从头开始。'
            : '';

        return [
            {
                title: '欢迎来到 RoadbookMaker',
                content: '这是一个“地图 + 行程”的规划工具。\n引导会按区域从上到下介绍：地图控件 → 工具栏 → 点/线编辑 → 日程编辑。\n（可随时点击“跳过”，或按 Esc 退出）' + demoHint
            },

            // --- 地图区域（右上角控件按顺序介绍） ---
            {
                selector: '#mapContainer',
                title: '地图区域',
                content: '主要的操作都发生在这里：添加标记点、连线、查看路线。\n点击遮罩空白处可快速进入下一步。'
            },
            {
                selector: '#fitViewBtn',
                title: '聚焦/调整视窗（Focus）',
                content: '点“🎯”自动调整视窗，让所有点/线都显示在画面里。\n快捷键：F\n鼠标悬停 1 秒会出现“按日期范围聚焦”的功能入口。'
            },
            {
                selector: '#helpBtn',
                title: '帮助（Helper）',
                content: '点“❓”可随时打开完整帮助与快捷键说明。'
            },
            {
                selector: '#themeToggleBtn',
                title: '主题切换',
                content: '右上角这里可以切换明亮/暗色主题，会记住你的偏好。',
                tooltipPlacement: 'bottom',
                tooltipAlign: 'end'
            },

            // --- 顶部工具栏（按从左到右的编辑区域介绍） ---
            {
                selector: '#searchInput',
                title: '搜索地点',
                content: '输入地点名回车搜索；也可以用快捷键 / 快速聚焦到搜索框。'
            },
            {
                selector: '#searchMethodSelect',
                title: '搜索源设置',
                content: '这里可以切换搜索服务（自动/Photon/Nominatim/高德/天地图等）。\n不确定选哪个时用“自动分配”。'
            },
            {
                selector: '#addMarkerBtn',
                title: '标记（新增点）',
                content: '点击“📍 标记”进入添加模式，然后在地图上点击即可落点。\n快捷键：A'
            },
            {
                selector: '#connectMarkersBtn',
                title: '连线（新增边）',
                content: '点击“🔗 连线”选择两个点并创建连接线。\n快捷键：C'
            },
            {
                selector: '#mapContainer',
                title: '删除点/边（不会自动执行）',
                content: '删除操作需要你手动执行：\n1) 先点击选中一个标记点或连接线（会打开详情面板）\n2) 按键盘 D / Backspace / Delete 删除\n或在详情面板里点“删除”按钮。'
            },
            {
                selector: '#mapSourceSelect',
                title: '地图设置（地图源）',
                content: '这里可以切换地图源（OSM/高德/Google/影像等）。\n切换后会自动保存到本地。'
            },
            {
                selector: '#exportDropdownBtn',
                title: '导出与分享',
                content: '用“📤 导出”导出 JSON/HTML/TXT/ICS/图片，方便备份或分享。'
            },
            {
                selector: '#importBtn',
                title: '导入',
                content: '点“📥 导入”可导入 JSON/HTML/PNG 备份文件，恢复你的路书。'
            },
            {
                selector: '#clearCacheBtn',
                title: '清空数据（谨慎）',
                content: '“🗑️ 清空数据”会删除本地缓存，适合从头开始。\n建议清空前先导出备份。'
            },

            // --- 地图上的点/线编辑（演示自动打开面板） ---
            {
                getTargetElement: () => getFirstMarkerElement(),
                title: markerClickStepTitle,
                content: '已自动演示：点击标记点会打开“标记点详情”。\n你也可以自己再点一次其它标记点，体验切换编辑对象。',
                beforeEnter: () => closeAnyDetailPanels(),
                afterEnter: () => {
                    setTimeout(() => openFirstMarkerDetailAndFocus(), 120);
                }
            },
            {
                selector: '#markerDetailPanel',
                title: '标记点详情面板',
                content: '这里可以改名称、时间点、图标、标注内容等。\n多数改动会实时保存到本地缓存。\n右上角 × 可关闭面板。'
            },
            {
                getTargetElement: () => getFirstConnectionElement(),
                title: connectionClickStepTitle,
                content: '已自动演示：点击连接线（或中间交通图标）会打开“连接线详情”。\n你可以再点击其它连接线查看差异。',
                beforeEnter: () => closeAnyDetailPanels(),
                afterEnter: () => {
                    setTimeout(() => openFirstConnectionDetailAndFocus(), 120);
                }
            },
            {
                selector: '#connectionDetailPanel',
                title: '连接线详情面板',
                content: '这里可以切换交通方式、修改时间/耗时、编辑标注与 Logo。\n右上角 × 可关闭面板。'
            },
            {
                selector: '#mapContainer',
                title: '右键拖拽连线（更快）',
                content: '在“查看模式”下：\n1) 右键按住一个标记点开始拖拽\n2) 拖到另一个标记点松开\n即可自动创建连接线（会按距离自动推荐交通方式）。'
            },

            // --- 右侧日程编辑（按日期） ---
            {
                selector: '#markerListPanel',
                title: '日程列表（按日期分组）',
                content: '右侧日程列表会按日期分组显示。\n点击每个日期标题左侧的“文件夹/展开”图标，可以展开/收起当天的条目。',
                // 进入日程区域前，必须先退出“点/边详情”以及“日期筛选”状态，回到分组列表层
                beforeEnter: () => closeAnyDetailPanels(),
                afterEnter: () => {
                    try {
                        const panel = document.getElementById('markerListPanel');
                        if (panel && typeof panel.scrollIntoView === 'function') {
                            panel.scrollIntoView({ block: 'nearest' });
                        }
                    } catch {
                        // ignore
                    }
                }
            },
            {
                getTargetElement: () => getFirstDateExpandToggleElement(),
                title: '展开/收起“文件夹”',
                content: '这里就是“文件夹/展开”按钮：\n- 点击可展开/收起该日期下的所有点\n- 展开后就能在下面看到当天的地点列表',
                afterEnter: () => {
                    // 确保演示时处于“展开”状态（不做收起再展开的抖动）
                    setTimeout(() => ensureFirstDateGroupExpanded(), 120);
                }
            },
            {
                getTargetElement: () => getFirstMarkerInfoUnderFirstDateGroup(),
                title: '点击条目编辑“点”',
                content: '展开后，点击下面的任意一条地点（条目）就会打开该点的编辑面板。\n（本步骤会自动演示一次）',
                beforeEnter: () => closeAnyDetailPanels(),
                afterEnter: () => {
                    setTimeout(() => {
                        // 先保证是展开状态
                        ensureFirstDateGroupExpanded();
                        // 再模拟点击条目打开点详情
                        clickFirstMarkerInfoUnderFirstDateGroupToOpenMarkerDetail();

                        // 演示完成后：如果原本是收起的，自动折叠回去（恢复原样）
                        setTimeout(() => {
                            restoreFirstDateGroupExpansionIfNeeded();
                        }, 900);
                    }, 180);
                }
            },
            {
                getTargetElement: () => getFirstDateHeaderElement(),
                title: '日程（按日期）编辑入口',
                content: '从“日期分组”进入日程编辑界面：\n已自动演示点击一个日期标题 → 进入该日期的详情。',
                beforeEnter: () => {
                    closeAnyDetailPanels();
                    // 在进入“日期详情”前，把文件夹展开状态恢复回演示前
                    setTimeout(() => restoreFirstDateGroupExpansionIfNeeded(), 0);
                },
                afterEnter: () => {
                    setTimeout(() => {
                        clickFirstDateHeaderToOpenDateDetail();
                    }, 600);
                }
            },
            {
                selector: '#dateDetailPanel',
                title: '日程（日期）详情面板',
                content: '这里是“日程/日期”的编辑界面：\n- 可写日期备注\n- 可记录预计消费\n关闭后会回到列表/地图继续编辑点和线。'
            }
        ];
    }

    function ensureDemoDataIfEmpty(options = {}) {
        try {
            const allowDemo = Boolean(options.allowDemo);
            // 自动弹出的引导：只对首次打开创建 demo；手动触发可按需允许创建 demo
            if (!allowDemo) return { demoCreated: false, hasExistingData: true };
            if (!window.app || !window.app.map) return { demoCreated: false, hasExistingData: false };

            // 如果内存里已经有点/线，则不重复创建
            const hasMarkers = Array.isArray(window.app.markers) && window.app.markers.length > 0;
            const hasConnections = Array.isArray(window.app.connections) && window.app.connections.length > 0;
            if (hasMarkers || hasConnections) {
                return { demoCreated: false, hasExistingData: true };
            }

            const center = window.app.map.getCenter ? window.app.map.getCenter() : { lat: 39.90923, lng: 116.397428 };
            const p1 = L.latLng(center.lat, center.lng);
            const p2 = L.latLng(center.lat, center.lng + 0.03);

            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.value = '示例点 A';
            window.app.addMarker(p1);

            if (searchInput) searchInput.value = '示例点 B';
            window.app.addMarker(p2);

            // 创建一条连接线（transportType=null 触发自动推荐）
            if (Array.isArray(window.app.markers) && window.app.markers.length >= 2) {
                window.app.createConnection(window.app.markers[0], window.app.markers[1], null);
            }

            // 关闭自动弹出的详情面板，让后续步骤由用户点击触发
            closeAnyDetailPanels();

            // 聚焦到示例数据
            try {
                if (typeof window.app.handleFitViewClick === 'function') {
                    window.app.handleFitViewClick();
                }
            } catch {
                // ignore
            }

            return { demoCreated: true, hasExistingData: false };
        } catch {
            return { demoCreated: false, hasExistingData: false };
        }
    }

    async function waitForAppReady() {
        // 1) 等 window.app
        const start = Date.now();
        while (Date.now() - start < 8000) {
            if (window.app && window.app.map) break;
            await new Promise(r => setTimeout(r, 50));
        }
        // 2) 等 geolocation loading 结束，避免遮挡/干扰
        const start2 = Date.now();
        while (Date.now() - start2 < 4500) {
            const loading = document.getElementById('geolocation-loading');
            if (!loading) break;
            await new Promise(r => setTimeout(r, 80));
        }
        // 3) 给 Leaflet 一点时间完成布局
        await new Promise(r => setTimeout(r, 80));
    }

    function shouldAutoStartTour() {
        const helpParam = getHelpParam();
        if (helpParam === 'force') return true;
        if (helpParam === 'disable') return false;
        if (hasShareFlow()) return false;

        const state = getTourState();
        if (state === 'done' || state === 'skipped') return false;

        return isFirstOpenAtLoad();
    }

    async function maybeStart() {
        try {
            if (!shouldAutoStartTour()) return;

            await waitForAppReady();

            // 再次确认：避免等待过程中用户已经导入了数据
            const helpParam = getHelpParam();
            if (helpParam !== 'force') {
                if (!isFirstOpenAtLoad()) return;
            }

            const meta = ensureDemoDataIfEmpty({ allowDemo: isFirstOpenAtLoad() });
            // 如果不是空地图，尝试标记为“已有数据”（用于文案）
            const hasExistingData = meta.hasExistingData || (!isFirstOpenAtLoad());

            const tour = new RoadbookHelpTour(buildDefaultSteps({
                demoCreated: meta.demoCreated,
                hasExistingData
            }));
            window.__roadbookHelpTour = tour;
            tour.start(0);
        } catch (e) {
            console.warn('Help tour init failed:', e);
        }
    }

    // 提供一个可手动调用的入口（例如：控制台/其它按钮）
    window.startRoadbookHelpTour = async function () {
        await waitForAppReady();
        // 手动触发：如果当前地图是空的，则允许创建 demo（两点一线）保证引导可用
        const allowDemo = isAppMapEmptyNow();
        const meta = ensureDemoDataIfEmpty({ allowDemo });
        const hasExistingData = meta.hasExistingData || (!allowDemo);
        const tour = new RoadbookHelpTour(buildDefaultSteps({
            demoCreated: meta.demoCreated,
            hasExistingData
        }));
        window.__roadbookHelpTour = tour;
        tour.start(0);
    };

    // 页面就绪后自动判断
    window.addEventListener('DOMContentLoaded', () => {
        // 仅在非 file:// 环境下，URL 参数才叫“http param”，但这里统一按 location.search 处理。
        maybeStart();
    });
})();
