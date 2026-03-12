// AI Assistant Module for RoadbookMaker
class RoadbookAIAssistant {
    constructor(app) {
        this.app = app;
        this.enabled = false;
        this.model = '';
        this.apiBase = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1') || window.location.protocol === 'file:'
            ? 'http://127.0.0.1:5436'
            : window.location.origin;

        // DOM Elements
        this.container = null;
        this.chatWindow = null;
        this.messagesContainer = null;
        this.inputElement = null;
        this.sendBtn = null;
        this.toggleBtn = null;

        // State
        this.isOpen = false;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.messages = [];
        this.isStreaming = false;

        // Command System
        this.commands = {};
        this.suggestionsContainer = null;
        this.activeSuggestionIndex = -1;
        this.filteredCommands = [];

        this.registerCommands();
        this.init();

        // 监听登录成功事件，重新初始化（获取配置并显示UI）
        window.addEventListener('roadbook:login-success', () => {
            console.log('AI Assistant: Login success event received, re-initializing...');
            this.init();
        });
    }

    registerCommands() {
        // Register default commands
        this.registerCommand('clear', '清空当前对话历史', async () => {
            this.messages = [];
            this.renderMessages();

            await this.saveSession([]);

            this.appendMessageElement({ role: 'system', content: '🧹 对话历史已清空' });
            return true; // Command executed successfully
        });

        this.registerCommand('generate', '根据提示词生成行程图', async (args) => {
            if (!args || args.length === 0) {
                this.appendMessageElement({ role: 'system', content: '⚠️ 请输入提示词，例如：/generate 北京一日游' });
                return true;
            }

            const prompt = args.join(' ');
            // Construct a strong prompt to force map generation
            const aiPrompt = `Please generate a COMPLETE and DETAILED itinerary based on the following description. You MUST output JSON commands (add_marker, connect_markers) to visualize the FULL itinerary on the map.
IMPORTANT RULES:
1. Do NOT stop to ask the user questions or for clarification. Generate the full itinerary immediately based on your best understanding.
2. Ensure every significant location mentioned or implied is added as a marker, and they are logically connected.
3. Try to use "search_location" for accurate coordinates first. However, if search fails or returns no results, DO NOT ask the user. Instead, use your internal knowledge to provide the best possible estimated coordinates and proceed with generating the itinerary.
4. Generate the entire plan first, then let the user make adjustments later.
Description: ${prompt}`;

            // Send as a user message (which triggers the AI)
            await this.sendMessage(aiPrompt);
            return true;
        });

        this.registerCommand('help', '显示可用命令', () => {
            let helpText = '### 可用命令\n\n';
            Object.entries(this.commands).forEach(([name, cmd]) => {
                helpText += `- \`/${name}\`: ${cmd.description}\n`;
            });
            this.appendMessageElement({ role: 'system', content: helpText });
            return true;
        });
    }

    registerCommand(name, description, handler) {
        this.commands[name] = {
            description,
            handler
        };
    }

    async init() {
        console.log('AI Assistant: Initializing...');
        try {
            const config = await this.fetchConfig();
            console.log('AI Assistant: Config fetched', config);

            // 无论是否配置成功，都尝试创建UI，方便调试（如果未启用会显示警告）
            // 如果后端未配置，config可能为null，此时我们假设未启用
            const isEnabled = config && config.enabled;
            this.model = config ? config.model : '';

            // 如果未登录，localStorage中没有token，fetchConfig返回null
            // 这里我们尝试总是创建UI，但在没有config时给出提示

            if (isEnabled) {
                this.enabled = true;
                this.createUI();
                this.loadHistory();
                console.log('Roadbook AI Assistant UI created (Enabled)');
            } else {
                console.warn('AI Assistant: Disabled by config or not logged in. UI not created.');
                // 如果你希望在未登录时也能看到图标（虽然不能用），可以取消下面这行的注释
                // this.createUI();
            }
        } catch (error) {
            console.error('Failed to initialize AI Assistant:', error);
        }
    }

    async fetchConfig() {
        try {
            const token = localStorage.getItem('online_token');
            if (!token) {
                console.warn('AI Assistant: No online_token found in localStorage. Please login first.');
                return null;
            }

            const headers = { 'Authorization': `Bearer ${token}` };
            console.log(`AI Assistant: Fetching config from ${this.apiBase}/api/v1/ai/config`);

            const response = await fetch(`${this.apiBase}/api/v1/ai/config`, { headers });
            if (response.ok) {
                return await response.json();
            } else {
                console.warn('AI Assistant: Config request failed', response.status, response.statusText);
            }
        } catch (e) {
            console.error('AI Assistant: Config fetch error', e);
        }
        return null;
    }

    async loadHistory() {
        try {
            const token = localStorage.getItem('online_token');
            const headers = {};
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            } else {
                return;
            }

            const response = await fetch(`${this.apiBase}/api/v1/ai/session`, { headers });
            if (response.ok) {
                const data = await response.json();
                if (data.messages && Array.isArray(data.messages)) {
                    this.messages = data.messages;
                    this.renderMessages();
                }
            }
        } catch (e) {
            console.error('Failed to load chat history', e);
        }
    }

    async saveSession(messages) {
        try {
            const token = localStorage.getItem('online_token');
            if (!token) return;

            const headers = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            };

            await fetch(`${this.apiBase}/api/v1/ai/session`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ messages: messages })
            });
        } catch (e) {
            console.error('Failed to save session', e);
        }
    }

    createUI() {
        // Create container for the button
        this.container = document.createElement('div');
        this.container.id = 'ai-assistant-container';
        this.container.className = 'ai-assistant-container';

        // Floating Toggle Button (The "Ball")
        this.toggleBtn = document.createElement('div');
        this.toggleBtn.className = 'ai-toggle-btn';
        this.toggleBtn.innerHTML = '🦄';
        this.toggleBtn.title = 'AI 助手';
        this.toggleBtn.onclick = () => {
            // Prevent click when dragging ends
            if (this.isDragging) return;
            this.toggleChat();
        };

        // Drag functionality for the button
        let chatStartLeft, chatStartTop;

        this.setupDraggable(this.toggleBtn, this.container,
            // onDragStart
            () => {
                if (this.isOpen && this.chatWindow) {
                    const rect = this.chatWindow.getBoundingClientRect();
                    chatStartLeft = rect.left;
                    chatStartTop = rect.top;

                    // Temporarily remove transition to make dragging smooth
                    this.chatWindow.style.transition = 'none';
                }
            },
            // onDrag
            (dx, dy) => {
                if (this.isOpen && this.chatWindow) {
                    this.chatWindow.style.left = `${chatStartLeft + dx}px`;
                    this.chatWindow.style.top = `${chatStartTop + dy}px`;
                }
            },
            // onDragEnd
            () => {
                 if (this.isOpen && this.chatWindow) {
                     this.chatWindow.style.transition = '';
                 }
            }
        );

        // Chat Window (attached directly to body for fixed positioning)
        this.chatWindow = document.createElement('div');
        this.chatWindow.className = 'ai-chat-window';

        // Header
        const header = document.createElement('div');
        header.className = 'ai-header';
        header.innerHTML = `
            <span>AI 助手 (${this.model})</span>
            <span class="ai-close-btn">&times;</span>
        `;
        header.querySelector('.ai-close-btn').onclick = () => this.toggleChat();

        // Make window draggable via header
        let iconStartLeft, iconStartTop;

        this.setupWindowDraggable(header, this.chatWindow,
            // onDragStart
            () => {
                const rect = this.container.getBoundingClientRect();
                iconStartLeft = rect.left;
                iconStartTop = rect.top;
            },
            // onDrag
            (dx, dy) => {
                this.container.style.left = `${iconStartLeft + dx}px`;
                this.container.style.top = `${iconStartTop + dy}px`;
                this.container.style.bottom = 'auto';
                this.container.style.right = 'auto';
            }
        );

        // Messages Area
        this.messagesContainer = document.createElement('div');
        this.messagesContainer.className = 'ai-messages';

        // Input Area
        const inputArea = document.createElement('div');
        inputArea.className = 'ai-input-area';
        inputArea.style.position = 'relative'; // For suggestions positioning

        // Suggestions Container
        this.suggestionsContainer = document.createElement('div');
        this.suggestionsContainer.className = 'ai-command-suggestions';
        inputArea.appendChild(this.suggestionsContainer);

        this.inputElement = document.createElement('textarea');
        this.inputElement.placeholder = '输入你的需求... (Shift+Enter 换行)';
        this.inputElement.addEventListener('keydown', (e) => {
            // Tab 键处理（增强版）：无论建议列表是否激活，只要是命令输入都尝试补全
            if (e.key === 'Tab') {
                const text = this.inputElement.value.trim();
                // 如果是命令前缀
                if (text.startsWith('/')) {
                    e.preventDefault(); // 阻止默认的 Tab 切换焦点行为

                    // 情况1: 建议列表已激活，直接选择当前高亮项
                    if (this.suggestionsContainer.classList.contains('active')) {
                        this.selectSuggestion(this.activeSuggestionIndex);
                        return;
                    }

                    // 情况2: 建议列表未激活（可能因为输入过快或焦点问题），手动匹配
                    const query = text.slice(1).toLowerCase();
                    const matches = Object.keys(this.commands).filter(cmd => cmd.startsWith(query));

                    if (matches.length > 0) {
                        // 补全第一个匹配项
                        const cmdName = matches[0];
                        this.inputElement.value = `/${cmdName} `;
                        this.hideSuggestions();
                    }
                }
                return; // 如果不是命令，保持默认 Tab 行为（或者也阻止？为了体验一致性，通常只处理命令）
            }

            if (this.suggestionsContainer.classList.contains('active')) {
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.moveSuggestionSelection(-1);
                    return;
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.moveSuggestionSelection(1);
                    return;
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    this.selectSuggestion(this.activeSuggestionIndex);
                    return;
                } else if (e.key === 'Escape') {
                    this.hideSuggestions();
                    return;
                }
            }

            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        this.inputElement.addEventListener('input', (e) => {
            this.handleInput(e.target.value);
        });

        this.sendBtn = document.createElement('button');
        this.sendBtn.innerHTML = '➤';
        this.sendBtn.onclick = () => this.sendMessage();

        inputArea.appendChild(this.inputElement);
        inputArea.appendChild(this.sendBtn);

        this.chatWindow.appendChild(header);
        this.chatWindow.appendChild(this.messagesContainer);
        this.chatWindow.appendChild(inputArea);

        this.container.appendChild(this.toggleBtn);

        document.body.appendChild(this.container);
        document.body.appendChild(this.chatWindow);

        // Set initial position to bottom-right of map container
        const mapContainer = document.getElementById('mapContainer');
        if (mapContainer) {
            const rect = mapContainer.getBoundingClientRect();
            // Place it at the bottom-right corner of the MAP container
            // (avoiding the right panel)
            const rightMargin = 10;
            const bottomMargin = 25;
            const buttonSize = 44;

            this.container.style.left = `${rect.right - buttonSize - rightMargin}px`;
            this.container.style.top = `${rect.bottom - buttonSize - bottomMargin}px`;
            this.container.style.right = 'auto';
            this.container.style.bottom = 'auto';
        }
    }

    setupDraggable(handle, target, onDragStart, onDrag, onDragEnd) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        const onMouseDown = (e) => {
            if (e.target !== handle && !handle.contains(e.target)) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = target.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            e.preventDefault();

            if (onDragStart) onDragStart();

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                this.isDragging = true; // Set class-level flag
            }

            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            // Boundary checks
            const maxLeft = window.innerWidth - target.offsetWidth;
            const maxTop = window.innerHeight - target.offsetHeight;

            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(0, Math.min(newTop, maxTop));

            target.style.left = `${newLeft}px`;
            target.style.top = `${newTop}px`;
            target.style.bottom = 'auto';
            target.style.right = 'auto';

            if (onDrag) {
                // Pass effective displacement (actual movement after boundaries)
                onDrag(newLeft - initialLeft, newTop - initialTop);
            }
        };

        const onMouseUp = () => {
            isDragging = false;
            // Delay clearing the class-level flag slightly to prevent click trigger
            setTimeout(() => {
                this.isDragging = false;
            }, 50);

            if (onDragEnd) onDragEnd();

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        handle.addEventListener('mousedown', onMouseDown);
    }

    setupWindowDraggable(handle, target, onDragStart, onDrag, onDragEnd) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        const onMouseDown = (e) => {
            // Don't drag if clicking close button
            if (e.target.closest('.ai-close-btn')) return;

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            // Get current computed style or style property
            const rect = target.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            e.preventDefault();

            if (onDragStart) onDragStart();

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            // Boundary checks
            const maxLeft = window.innerWidth - target.offsetWidth;
            const maxTop = window.innerHeight - target.offsetHeight;

            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(0, Math.min(newTop, maxTop));

            target.style.left = `${newLeft}px`;
            target.style.top = `${newTop}px`;

            if (onDrag) {
                // Pass effective displacement
                onDrag(newLeft - initialLeft, newTop - initialTop);
            }
        };

        const onMouseUp = () => {
            isDragging = false;

            if (onDragEnd) onDragEnd();

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        handle.addEventListener('mousedown', onMouseDown);
    }

    toggleChat() {
        this.isOpen = !this.isOpen;

        if (this.isOpen) {
            // Calculate optimal position before showing
            this.positionWindow();

            this.chatWindow.classList.add('open');
            // Wait for transition
            setTimeout(() => {
                this.scrollToBottom();
                this.inputElement.focus();
            }, 100);
        } else {
            this.chatWindow.classList.remove('open');
        }
    }

    positionWindow() {
        const btnRect = this.toggleBtn.getBoundingClientRect();
        const winWidth = 380; // Approximate width or get actual if rendered
        const winHeight = 600; // Approximate height

        const screenW = window.innerWidth;
        const screenH = window.innerHeight;

        // Horizontal positioning
        // Default to left of button
        let left = btnRect.left - winWidth - 10;

        // If not enough space on left, try right
        if (left < 10) {
            left = btnRect.right + 10;
            // If right is also too small (e.g. huge button in middle), center it
            if (left + winWidth > screenW) {
                left = (screenW - winWidth) / 2;
            }
        }

        // Vertical positioning
        // Default to bottom aligned with button
        let top = btnRect.bottom - winHeight;

        // If goes off top
        if (top < 10) {
            // Try aligning top with button top
            top = btnRect.top;
            // If goes off bottom
            if (top + winHeight > screenH) {
                // Center vertically
                top = (screenH - winHeight) / 2;
            }
        }

        // Final boundary enforcement
        left = Math.max(10, Math.min(left, screenW - winWidth - 10));
        top = Math.max(10, Math.min(top, screenH - winHeight - 10));

        this.chatWindow.style.left = `${left}px`;
        this.chatWindow.style.top = `${top}px`;
    }

    renderMessages() {
        this.messagesContainer.innerHTML = '';
        this.messages.forEach(msg => {
            // Filter out internal system prompt which shouldn't be visible to user
            if (msg.role === 'system' && (msg.content.includes('You are RoadbookAI') || msg.content.includes('Current Context'))) {
                return;
            }
            this.appendMessageElement(msg);
        });
        this.scrollToBottom();
    }

    appendMessageElement(msg) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `ai-message ${msg.role}`;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        // Simple markdown parsing can be added here if needed
        // For now, just handle line breaks
        contentDiv.innerText = msg.content;

        msgDiv.appendChild(contentDiv);
        this.messagesContainer.appendChild(msgDiv);
        this.scrollToBottom();
    }

    getSystemPrompt() {
        if (!this.app) return '';

        // Markers
        const markersList = (this.app.markers || []).map((m, i) =>
            `${i}. ${m.title} [${m.position[0].toFixed(4)}, ${m.position[1].toFixed(4)}] (ID: ${m.id}, Date: ${m.dateTime || 'None'})`
        ).join('\n') || 'None';

        // Connections
        const connectionsList = (this.app.connections || []).map((c, i) => {
            const startName = c.startTitle || (this.app.markers.find(m => m.id === c.startId)?.title || 'Unknown');
            const endName = c.endTitle || (this.app.markers.find(m => m.id === c.endId)?.title || 'Unknown');
            return `${i}. ${startName} -> ${endName} (${c.transportType}) (ID: ${c.id}, Date: ${c.dateTime || 'None'})`
        }).join('\n') || 'None';

        // Date Notes
        const dateNotesList = Object.entries(this.app.dateNotes || {}).map(([date, note]) =>
            `- ${date}: ${note}`
        ).join('\n') || 'None';

        // Map Status
        let mapCenter = 'Unknown';
        let mapBounds = 'Unknown';
        let zoomLevel = 'Unknown';
        if (this.app.map) {
            const center = this.app.map.getCenter();
            mapCenter = `[${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}]`;

            const bounds = this.app.map.getBounds();
            const ne = bounds.getNorthEast();
            const sw = bounds.getSouthWest();
            mapBounds = `NE[${ne.lat.toFixed(4)}, ${ne.lng.toFixed(4)}], SW[${sw.lat.toFixed(4)}, ${sw.lng.toFixed(4)}]`;

            zoomLevel = this.app.map.getZoom();
        }

        return `You are RoadbookAI, an intelligent travel planning assistant embedded in RoadbookMaker.

## Current Context
- Map Center: ${mapCenter}
- Map Bounds: ${mapBounds}
- Zoom Level: ${zoomLevel}
- Markers:
${markersList}
- Connections:
${connectionsList}
- Date Notes:
${dateNotesList}

## Capabilities
You can control the map by outputting JSON commands inside Markdown code blocks (\`\`\`json ... \`\`\`).
You MUST use IDs (not list indexes) for all operations.
The 'dateTime' field should be in "YYYY-MM-DD HH:MM:SS" format. It can be a single string or an array of strings (e.g. ["2025-01-01 10:00:00", "2025-01-02 14:00:00"]) if the location is visited multiple times.
IMPORTANT: Ensure that the generated itinerary covers ALL dates mentioned in the user's request.
IMPORTANT: A marker can only have ONE time point per calendar day. If multiple visits to the same location occur on the same day, please use the earliest time or consolidate them.

### 1. Add a Marker
You MUST generate a unique \`id\` (e.g., a large integer timestamp like ${Date.now()}) for the new marker.
\`\`\`json
{
  "action": "add_marker",
  "id": 1715000000000,
  "title": "Location Name",
  "lat": 39.9163, // You must provide specific coordinates
  "lng": 116.3972,
  "dateTime": "2025-01-01 10:00:00" // Optional: The date and time for this marker
}
\`\`\`

### 2. Connect Markers
Use marker IDs. If you just added a marker, use the same ID you generated.
IMPORTANT: The start_id and end_id MUST be different. Do not create a connection from a marker to itself.
\`\`\`json
{
  "action": "connect_markers",
  "start_id": 123456789,
  "end_id": 1715000000000,
  "transport": "car",
  "dateTime": "2025-01-01 12:00:00" // Optional: The date and time for this connection
}
\`\`\`
(Types: car, walk, train, plane, subway, bus, cruise)

### 3. Update Marker
Use marker ID. Fields are optional.
\`\`\`json
{
  "action": "update_marker",
  "id": 123456789,
  "title": "New Name",
  "lat": 39.9,
  "lng": 116.4,
  "dateTime": "2025-01-01 11:00:00"
}
\`\`\`

### 4. Remove Marker
Use marker ID.
\`\`\`json
{
  "action": "remove_marker",
  "id": 123456789
}
\`\`\`

### 5. Update Connection
Use connection ID.
\`\`\`json
{
  "action": "update_connection",
  "id": 111222333,
  "transport": "train",
  "dateTime": "2025-01-01 13:00:00"
}
\`\`\`

### 6. Remove Connection
Use connection ID.
\`\`\`json
{
  "action": "remove_connection",
  "id": 111222333
}
\`\`\`

### 7. Get Map Details
Request detailed map data (JSON) to be added to the conversation history.
Use this when you need precise coordinates or full details that aren't in the System Context.
\`\`\`json
{
  "action": "get_map_details"
}
\`\`\`

### 8. Search Location
Search for a location to get coordinates. Use this when the user mentions a place name but doesn't provide coordinates, or when you need more accurate coordinates than your internal knowledge.
This tool returns up to 3 search results. You should use the results to propose a plan or directly add markers.
\`\`\`json
{
  "action": "search_location",
  "query": "Tiananmen Square"
}
\`\`\`

## Instructions
1. Always respond in the user's language.
2. Output multiple JSON blocks for multiple actions.
3. Be concise.
4. IMPORTANT: NEVER use JSON code blocks for examples or explanations. Only use JSON code blocks when you intend to trigger a map action immediately.
5. If you need to give an example, use plain text or a different code block format (like 'text').
6. IMPORTANT: The JSON parser supports comments (//) but please keep JSON clean.
7. IMPORTANT: When adding markers, always generate and include a unique 'id' field so you can reference it immediately.
8. CRITICAL: Unless the user gives a clear and direct instruction to modify the itinerary (like "add", "remove", "change", "connect"), DO NOT use any map action JSON. First, propose your suggestion as plain text and ask for the user's permission to proceed.
`;
    }

    handleInput(text) {
        if (text.startsWith('/')) {
            const query = text.slice(1).toLowerCase();
            this.filteredCommands = Object.keys(this.commands).filter(cmd =>
                cmd.startsWith(query)
            );

            if (this.filteredCommands.length > 0) {
                this.showSuggestions();
            } else {
                this.hideSuggestions();
            }
        } else {
            this.hideSuggestions();
        }
    }

    showSuggestions() {
        this.suggestionsContainer.innerHTML = '';
        this.suggestionsContainer.classList.add('active');
        this.activeSuggestionIndex = 0;

        this.filteredCommands.forEach((cmdName, index) => {
            const cmd = this.commands[cmdName];
            const div = document.createElement('div');
            div.className = 'ai-command-item';
            if (index === 0) div.classList.add('selected');

            div.innerHTML = `
                <span class="cmd-name">/${cmdName}</span>
                <span class="cmd-desc">${cmd.description}</span>
            `;

            div.onclick = () => {
                this.selectSuggestion(index);
                this.inputElement.focus();
            };

            this.suggestionsContainer.appendChild(div);
        });
    }

    hideSuggestions() {
        this.suggestionsContainer.classList.remove('active');
        this.activeSuggestionIndex = -1;
    }

    moveSuggestionSelection(direction) {
        if (!this.filteredCommands.length) return;

        const items = this.suggestionsContainer.querySelectorAll('.ai-command-item');
        items[this.activeSuggestionIndex]?.classList.remove('selected');

        this.activeSuggestionIndex += direction;

        if (this.activeSuggestionIndex < 0) {
            this.activeSuggestionIndex = this.filteredCommands.length - 1;
        } else if (this.activeSuggestionIndex >= this.filteredCommands.length) {
            this.activeSuggestionIndex = 0;
        }

        const newItem = items[this.activeSuggestionIndex];
        newItem.classList.add('selected');
        newItem.scrollIntoView({ block: 'nearest' });
    }

    selectSuggestion(index) {
        if (index >= 0 && index < this.filteredCommands.length) {
            const cmdName = this.filteredCommands[index];
            this.inputElement.value = `/${cmdName} `;
            this.hideSuggestions();
        }
    }

    async sendMessage(textOverride = null) {
        let text = textOverride;
        let isFromInput = false;

        if (!text) {
            text = this.inputElement.value.trim();
            isFromInput = true;
        }

        if (!text || this.isStreaming) return;

        // Check for commands
        if (text.startsWith('/')) {
            const parts = text.slice(1).split(' ');
            const cmdName = parts[0].toLowerCase();
            const args = parts.slice(1);

            if (this.commands[cmdName]) {
                if (isFromInput) this.inputElement.value = '';
                const result = await this.commands[cmdName].handler(args);
                if (result) return; // Command handled fully
            }
        }

        // Add user message
        const userMsg = { role: 'user', content: text };
        this.messages.push(userMsg);
        this.appendMessageElement(userMsg);

        if (isFromInput) {
            this.inputElement.value = '';
        }

        await this.generateAIResponse();
    }

    async generateAIResponse() {
        if (this.isStreaming) return;
        
        this.isStreaming = true;
        this.sendBtn.disabled = true;

        // Prepare context with system prompt
        const systemMsg = { role: 'system', content: this.getSystemPrompt() };
        // Limit history to last 6 messages (to include the latest user message and some context)
        const recentMessages = this.messages.slice(-6);
        const context = [systemMsg, ...recentMessages];

        // AbortController for timeout management
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s total timeout for connection

        try {
            const token = localStorage.getItem('online_token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(`${this.apiBase}/api/v1/ai/chat`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ messages: context }),
                signal: controller.signal
            });

            clearTimeout(timeoutId); // Clear connection timeout

            if (!response.ok) {
                throw new Error('API request failed');
            }

            // Handle streaming response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            // Create placeholder for assistant message
            const assistantMsg = { role: 'assistant', content: '' };
            this.messages.push(assistantMsg);

            const msgDiv = document.createElement('div');
            msgDiv.className = `ai-message assistant`;
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            msgDiv.appendChild(contentDiv);
            this.messagesContainer.appendChild(msgDiv);

            // Read loop with activity timeout
            let activityTimeoutId = null;
            const resetActivityTimeout = () => {
                if (activityTimeoutId) clearTimeout(activityTimeoutId);
                activityTimeoutId = setTimeout(() => {
                    console.warn('AI stream stalled, aborting...');
                    reader.cancel(); // Cancel the reader
                    // We don't throw here because we want to keep what we have so far
                    // But we need to break the loop. Reader cancel usually makes read() return done or reject.
                }, 30000); // 30s no data timeout
            };

            resetActivityTimeout();

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    resetActivityTimeout(); // Reset timeout on data

                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') continue;

                            try {
                                const json = JSON.parse(data);
                                const content = json.choices[0]?.delta?.content || '';
                                if (content) {
                                    assistantMsg.content += content;
                                    // Simple markdown formatting for code blocks
                                    contentDiv.innerHTML = this.formatMessageContent(assistantMsg.content);
                                    this.scrollToBottom();
                                }
                            } catch (e) {
                                // console.error('Error parsing stream:', e);
                            }
                        }
                    }
                }
            } catch (streamError) {
                console.error('Stream reading error:', streamError);
                // If it was just a stall, we might want to keep the partial message
                if (assistantMsg.content.length === 0) {
                    throw streamError; // Rethrow if we got nothing
                }
                this.appendMessageElement({ role: 'system', content: '⚠️ 回复传输中断，已显示部分内容' });
            } finally {
                if (activityTimeoutId) clearTimeout(activityTimeoutId);
            }

            // Parse and execute actions after message is complete (or interrupted)
            if (assistantMsg.content.length > 0) {
                // Use setTimeout to allow the finally block to execute first and reset isStreaming
                setTimeout(() => {
                    this.parseAndExecuteAction(assistantMsg.content, contentDiv);
                }, 0);
            }

        } catch (error) {
            console.error('Chat error:', error);
            if (error.name === 'AbortError') {
                this.appendMessageElement({ role: 'system', content: '❌ 请求超时，请检查网络或稍后重试' });
            } else {
                this.appendMessageElement({ role: 'system', content: '❌ 发送失败，请稍后重试' });
            }
        } finally {
            this.isStreaming = false;
            this.sendBtn.disabled = false;
            this.scrollToBottom();
        }
    }

    formatMessageContent(text) {
        // Basic formatting: newlines to <br>, code blocks to <pre>
        let formatted = text
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Code blocks
        formatted = formatted.replace(/```json([\s\S]*?)```/g, '<pre><code class="language-json">$1</code></pre>');
        formatted = formatted.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

        // Inline code
        formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Line breaks
        formatted = formatted.replace(/\n/g, '<br>');

        return formatted;
    }

    stripJsonComments(jsonStr) {
        let result = '';
        let i = 0;
        let inString = false;
        let isEscaped = false;

        while (i < jsonStr.length) {
            const char = jsonStr[i];
            const nextChar = jsonStr[i + 1];

            if (inString) {
                if (char === '\\' && !isEscaped) {
                    isEscaped = true;
                } else if (char === '"' && !isEscaped) {
                    inString = false;
                } else {
                    isEscaped = false;
                }
                result += char;
                i++;
            } else {
                if (char === '"') {
                    inString = true;
                    result += char;
                    i++;
                } else if (char === '/' && nextChar === '/') {
                    // Single line comment
                    i += 2;
                    while (i < jsonStr.length && jsonStr[i] !== '\n' && jsonStr[i] !== '\r') {
                        i++;
                    }
                } else if (char === '/' && nextChar === '*') {
                    // Multi line comment
                    i += 2;
                    while (i < jsonStr.length && !(jsonStr[i] === '*' && jsonStr[i + 1] === '/')) {
                        i++;
                    }
                    i += 2; // Skip */
                } else {
                    result += char;
                    i++;
                }
            }
        }
        return result;
    }

    extractJsonObjects(text) {
        const results = [];
        let braceDepth = 0;
        let startIndex = -1;
        let inString = false;
        let escape = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (inString) {
                if (escape) {
                    escape = false;
                } else if (char === '\\') {
                    escape = true;
                } else if (char === '"') {
                    inString = false;
                }
            } else {
                if (char === '"') {
                    inString = true;
                } else if (char === '{') {
                    if (braceDepth === 0) {
                        startIndex = i;
                    }
                    braceDepth++;
                } else if (char === '}') {
                    braceDepth--;
                    if (braceDepth === 0 && startIndex !== -1) {
                        const jsonCandidate = text.substring(startIndex, i + 1);
                        results.push(jsonCandidate);
                        startIndex = -1;
                    }
                }
            }
        }
        return results;
    }

    parseAndExecuteAction(text, containerElement) {
        // Step 1: Extract all potential JSON blocks
        // Priority 1: Markdown Code Blocks
        const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
        let blocks = [];
        let match;
        while ((match = codeBlockRegex.exec(text)) !== null) {
            blocks.push(match[1]);
        }

        // Priority 2: If no code blocks, scan the entire text
        let sourceText = text;
        if (blocks.length > 0) {
            sourceText = blocks.join('\n');
        }

        // Step 2: Remove comments
        sourceText = this.stripJsonComments(sourceText);

        // Step 3: Extract individual JSON objects using brace balancing
        const jsonObjects = this.extractJsonObjects(sourceText);

        // Keep track of the last marker added in this batch of execution
        let lastAddedMarkerId = null;
        let hasExecutedSyncAction = false;

        // Step 4: Parse and execute each JSON object
        for (const jsonStr of jsonObjects) {
            try {
                // Try parsing the extracted string
                const actionData = JSON.parse(jsonStr);

                // Basic validation: must be an object and have an action
                if (!actionData || typeof actionData !== 'object' || !actionData.action) {
                    continue;
                }

                if (this.app) {
                    if (actionData.action === 'add_marker') {
                        // Validate required params
                        if (actionData.lat === undefined || actionData.lng === undefined) {
                            console.error('AI Add Marker: Missing coordinates', actionData);
                            this.appendActionStatus(containerElement, `❌ 添加失败: 缺少坐标`);
                            continue;
                        }

                        if (this.app.aiAddMarker) {
                            const marker = this.app.aiAddMarker(actionData.title, actionData.lat, actionData.lng, actionData.id, actionData.dateTime);
                            if (marker) {
                                this.appendActionStatus(containerElement, `✅ 已添加标记点: ${marker.title}`);
                                lastAddedMarkerId = marker.id; // Record ID

                                const systemMsg = {
                                    role: 'user', // Changed from 'system' to 'user' to ensure compatibility with LLM APIs which might restrict system messages position
                                    content: `Action Result: Added marker "${marker.title}" with ID: ${marker.id}`
                                };
                                this.messages.push(systemMsg);
                                hasExecutedSyncAction = true;
                            } else {
                                this.appendActionStatus(containerElement, `❌ 添加失败: 坐标无效`);
                            }
                        }
                    } else if (actionData.action === 'connect_markers') {
                        if (this.app.aiConnectMarkers) {
                            // Support ID (preferred) or index (fallback)
                            let startId = actionData.start_id;
                            let endId = actionData.end_id;

                            // Fallback for old index-based AI output
                            if (startId === undefined && actionData.from_index !== undefined) {
                                // Check if from_index refers to "latest" or similar concept
                                if (typeof actionData.from_index === 'string' &&
                                    (actionData.from_index.includes('新') || actionData.from_index.includes('new') || actionData.from_index.includes('last'))) {
                                    startId = lastAddedMarkerId;
                                } else {
                                    const m = this.app.markers[actionData.from_index];
                                    if (m) startId = m.id;
                                }
                            }

                            if (endId === undefined && actionData.to_index !== undefined) {
                                    // Check if to_index refers to "latest" or similar concept
                                if (typeof actionData.to_index === 'string' &&
                                    (actionData.to_index.includes('新') || actionData.to_index.includes('new') || actionData.to_index.includes('last'))) {
                                    endId = lastAddedMarkerId;
                                } else {
                                    const m = this.app.markers[actionData.to_index];
                                    if (m) endId = m.id;
                                }
                            }

                            // One special case: if startId or endId is explicitly "latest" or -1
                            if (startId === 'latest' || startId === -1) startId = lastAddedMarkerId;
                            if (endId === 'latest' || endId === -1) endId = lastAddedMarkerId;

                            if (startId === undefined || endId === undefined) {
                                console.error('AI Connect Markers: Missing start or end ID', actionData);
                                this.appendActionStatus(containerElement, `❌ 连接失败: 起点或终点未指定`);
                                continue;
                            }

                            const success = this.app.aiConnectMarkers(startId, endId, actionData.transport || 'car', actionData.dateTime);
                            if (success) {
                                this.appendActionStatus(containerElement, `✅ 已连接标记点`);
                                const systemMsg = {
                                    role: 'user', 
                                    content: `Action Result: Connected markers ${startId} and ${endId}`
                                };
                                this.messages.push(systemMsg);
                                hasExecutedSyncAction = true;
                            } else {
                                this.appendActionStatus(containerElement, `❌ 连接失败: ID无效 (Start: ${startId}, End: ${endId})`);
                                const systemMsg = {
                                    role: 'user',
                                    content: `Action Failed: Connect markers failed - ID invalid (Start: ${startId}, End: ${endId})`
                                };
                                this.messages.push(systemMsg);
                                hasExecutedSyncAction = true; // Still trigger response to let AI know it failed
                            }
                        }
                    } else if (actionData.action === 'remove_marker') {
                        if (this.app.aiRemoveMarker) {
                            // Support ID (preferred) or index (fallback)
                            let id = actionData.id;
                            if (id === undefined && actionData.index !== undefined) {
                                const m = this.app.markers[actionData.index];
                                if (m) id = m.id;
                            }

                            if (id === undefined) {
                                this.appendActionStatus(containerElement, `❌ 删除失败: ID未指定`);
                                continue;
                            }

                            const success = this.app.aiRemoveMarker(id);
                            if (success) {
                                this.appendActionStatus(containerElement, `✅ 已删除标记点`);
                                const systemMsg = {
                                    role: 'user',
                                    content: `Action Result: Removed marker with ID: ${id}`
                                };
                                this.messages.push(systemMsg);
                                hasExecutedSyncAction = true;
                            } else {
                                this.appendActionStatus(containerElement, `❌ 删除失败: ID无效`);
                                const systemMsg = {
                                    role: 'user',
                                    content: `Action Failed: Remove marker failed - ID invalid (${id})`
                                };
                                this.messages.push(systemMsg);
                                hasExecutedSyncAction = true;
                            }
                        }
                    } else if (actionData.action === 'update_marker') {
                        if (this.app.aiUpdateMarker) {
                            // Support ID (preferred) or index (fallback)
                            let id = actionData.id;
                            if (id === undefined && actionData.index !== undefined) {
                                const m = this.app.markers[actionData.index];
                                if (m) id = m.id;
                            }

                            if (id === undefined) {
                                this.appendActionStatus(containerElement, `❌ 更新失败: ID未指定`);
                                continue;
                            }

                            const success = this.app.aiUpdateMarker(id, actionData.title, actionData.lat, actionData.lng, actionData.dateTime);
                            if (success) {
                                this.appendActionStatus(containerElement, `✅ 已更新标记点`);
                                const systemMsg = {
                                    role: 'user',
                                    content: `Action Result: Updated marker with ID: ${id}`
                                };
                                this.messages.push(systemMsg);
                                hasExecutedSyncAction = true;
                            } else {
                                this.appendActionStatus(containerElement, `❌ 更新失败: ID无效`);
                                const systemMsg = {
                                    role: 'user',
                                    content: `Action Failed: Update marker failed - ID invalid (${id})`
                                };
                                this.messages.push(systemMsg);
                                hasExecutedSyncAction = true;
                            }
                        }
                    } else if (actionData.action === 'remove_connection') {
                        if (this.app.aiRemoveConnection) {
                            // Support ID (preferred) or index (fallback)
                            let id = actionData.id;
                            if (id === undefined && actionData.index !== undefined) {
                                const c = this.app.connections[actionData.index];
                                if (c) id = c.id;
                            }

                            if (id === undefined) {
                                this.appendActionStatus(containerElement, `❌ 删除失败: ID未指定`);
                                continue;
                            }

                            const success = this.app.aiRemoveConnection(id);
                            if (success) {
                                this.appendActionStatus(containerElement, `✅ 已删除连接线`);
                                const systemMsg = {
                                    role: 'user',
                                    content: `Action Result: Removed connection with ID: ${id}`
                                };
                                this.messages.push(systemMsg);
                                hasExecutedSyncAction = true;
                            } else {
                                this.appendActionStatus(containerElement, `❌ 删除失败: ID无效`);
                                const systemMsg = {
                                    role: 'user',
                                    content: `Action Failed: Remove connection failed - ID invalid (${id})`
                                };
                                this.messages.push(systemMsg);
                                hasExecutedSyncAction = true;
                            }
                        }
                    } else if (actionData.action === 'update_connection') {
                        if (this.app.aiUpdateConnection) {
                            // Support ID (preferred) or index (fallback)
                            let id = actionData.id;
                            if (id === undefined && actionData.index !== undefined) {
                                const c = this.app.connections[actionData.index];
                                if (c) id = c.id;
                            }

                            if (id === undefined) {
                                this.appendActionStatus(containerElement, `❌ 更新失败: ID未指定`);
                                continue;
                            }

                            const success = this.app.aiUpdateConnection(id, actionData.transport, actionData.dateTime);
                            if (success) {
                                this.appendActionStatus(containerElement, `✅ 已更新连接线`);
                                const systemMsg = {
                                    role: 'user',
                                    content: `Action Result: Updated connection with ID: ${id}`
                                };
                                this.messages.push(systemMsg);
                                hasExecutedSyncAction = true;
                            } else {
                                this.appendActionStatus(containerElement, `❌ 更新失败: ID无效`);
                                const systemMsg = {
                                    role: 'user',
                                    content: `Action Failed: Update connection failed - ID invalid (${id})`
                                };
                                this.messages.push(systemMsg);
                                hasExecutedSyncAction = true;
                            }
                        }
                    // } else if (actionData.action === 'export_data') {
                    //     if (this.app && this.app.exportRoadbook) {
                    //         this.app.exportRoadbook();
                    //         this.appendActionStatus(containerElement, `✅ 已触发数据导出`);
                    //     }
                    } else if (actionData.action === 'get_map_details') {
                        if (this.app) {
                            const details = {
                                markers: this.app.markers.map(m => ({
                                    id: m.id,
                                    title: m.title,
                                    lat: m.position[0],
                                    lng: m.position[1],
                                    date: m.dateTime
                                })),
                                connections: this.app.connections.map(c => ({
                                    id: c.id,
                                    from_id: c.startId,
                                    to_id: c.endId,
                                    transport: c.transportType
                                })),
                                center: this.app.map ? this.app.map.getCenter() : null,
                                zoom: this.app.map ? this.app.map.getZoom() : null
                            };

                            const detailsStr = JSON.stringify(details, null, 2);

                            // Add to message history
                            const systemMsg = {
                                role: 'user', // Changed from 'system' to 'user' for compatibility
                                content: `Current Map Details:\n\`\`\`json\n${detailsStr}\n\`\`\``
                            };
                            this.messages.push(systemMsg);

                            // Display status only (do NOT display the full JSON content)
                            this.appendActionStatus(containerElement, `✅ 已获取地图详情到对话历史`);

                            // Auto-trigger next AI response to act on map details
                            this.generateAIResponse();
                        }
                    } else if (actionData.action === 'search_location') {
                        if (this.app && this.app.aiSearchLocation) {
                            const query = actionData.query;
                            if (!query) {
                                this.appendActionStatus(containerElement, `❌ 搜索失败: 未提供查询词`);
                                continue;
                            }

                            this.appendActionStatus(containerElement, `🔍 正在搜索: ${query}...`);
                            
                            // Execute search
                            this.app.aiSearchLocation(query).then(results => {
                                let content = '';
                                if (results && results.length > 0) {
                                    const resultsStr = JSON.stringify(results, null, 2);
                                    content = `Search Results for "${query}":\n\`\`\`json\n${resultsStr}\n\`\`\``;
                                    this.appendActionStatus(containerElement, `✅ 搜索完成，找到 ${results.length} 个结果`);
                                } else {
                                    content = `Search Results for "${query}": No results found.`;
                                    this.appendActionStatus(containerElement, `⚠️ 未找到相关结果`);
                                }

                                // Add to message history
                                const systemMsg = {
                                    role: 'user', // Changed from 'system' to 'user' for compatibility
                                    content: content
                                };
                                this.messages.push(systemMsg);
                                
                                // Display status only (do NOT display the full JSON content)
                                // this.appendMessageElement(systemMsg); // REMOVED to prevent showing raw JSON
                                
                                // Auto-trigger next AI response to act on search results
                                this.generateAIResponse();
                            });
                        }
                    }
                }
            } catch (actionError) {
                console.error('Error executing action:', actionError);
                this.appendActionStatus(containerElement, `❌ 执行出错: ${actionError.message}`);
            }
        }

        if (hasExecutedSyncAction) {
            this.generateAIResponse();
        }
    }

    appendActionStatus(container, text) {
        const statusDiv = document.createElement('div');
        statusDiv.className = 'ai-map-action';
        statusDiv.textContent = text;
        container.appendChild(statusDiv);
        this.scrollToBottom();
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    if (window.app) {
        window.aiAssistant = new RoadbookAIAssistant(window.app);
    } else {
        // Wait for app to initialize if needed, or just init
        setTimeout(() => {
            window.aiAssistant = new RoadbookAIAssistant(window.app);
        }, 1000);
    }
});
