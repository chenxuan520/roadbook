// app_search.js - 搜索相关方法

RoadbookApp.prototype.addSearchProviderComments = function() {
    const select = document.getElementById('searchMethodSelect');
    if (!select) return;

    const providerComments = {
        auto: '根据当前地图自动选择最合适的搜索服务。',
        gaode: '高德搜索，由后端服务器代理，适用于中国大陆区域, 需要 apikey。',
        tiansearch: '天地图搜索，由后端服务器代理，适用于中国大陆区域。',
        cnsearch: '百度搜索，由后端服务器代理，适用于中国大陆区域（可能不稳定）。',
        nominatim: 'OpenStreetMap官方搜索，全球范围适用，国外地址推荐。',
        overpass: '一个功能强大的OSM数据挖掘工具，语法复杂，稳定性差不推荐。',
        mapsearch: '一个第三方的中文OSM搜索服务，无需翻墙。',
        photon: '基于OpenStreetMap的快速搜索，全球范围适用。'
    };

    Array.from(select.options).forEach(option => {
        const provider = option.value;
        if (providerComments[provider]) {
            option.title = providerComments[provider];
        }
    });
};

// Helper to convert performance.now() diff to ms
RoadbookApp.prototype.performanceToMilliseconds = function(diff) {
    return Math.round(diff);
};

RoadbookApp.prototype.testSearchProviderLatency = async function(provider) {
    const urls = {
        nominatim: 'https://nominatim.openstreetmap.org/status.php',
        overpass: 'https://overpass-api.de/api/interpreter',
        mapsearch: 'https://map.011203.dpdns.org/search?q=test',
        photon: 'https://photon.komoot.io/api/?q=test',
        // For backend-proxied providers (gaode, tiansearch, cnsearch),
        // latency is not tested via HEAD request from frontend.
        // Backend /api/search/providers should ideally provide this info,
        // or these options are simply marked as "available" if not loginRequired.
    };

    const url = urls[provider];
    if (!url) {
        // If the provider is a backend-proxied one, assume OK unless specified by backend
        if (['gaode', 'tiansearch', 'cnsearch'].includes(provider)) {
            return {status: 'ok', latency: 0};
        }
        return {status: 'n/a'};
    }

    const startTime = performance.now();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        await fetch(url, {method: 'HEAD', mode: 'no-cors', signal: controller.signal});

        clearTimeout(timeoutId);
        const latency = this.performanceToMilliseconds(performance.now() - startTime);
        return {status: 'ok', latency};
    } catch (error) {
        return {status: 'error'};
    }
};

RoadbookApp.prototype.updateProviderIcons = async function() {
    const select = document.getElementById('searchMethodSelect');
    if (!select) return;

    if (this.searchProviderOriginalTexts.size === 0) {
        Array.from(select.options).forEach(option => {
            let cleanText = option.text;
            // Remove existing icons like ⏱️, ✅, ❌ etc.
            if (cleanText.length > 2 && !/^[a-zA-Z0-9]/.test(cleanText.charAt(0)) && cleanText.charAt(1) === ' ') {
                cleanText = cleanText.substring(2);
            }
            this.searchProviderOriginalTexts.set(option.value, cleanText);
        });
    }

    let backendProviders = [];
    let backendFetchFailed = false; // New flag to track if fetching backend providers failed
    try {
        const response = await fetch(`${apiBaseUrl}/api/search/providers`);
        if (response.ok) {
            backendProviders = await response.json();
        } else {
            console.error('Failed to fetch search providers from backend:', response.statusText);
            backendFetchFailed = true; // Set flag on HTTP error
        }
    } catch (error) {
        console.error('Error fetching search providers from backend:', error);
        backendFetchFailed = true; // Set flag on network error
    }

    const promises = Array.from(select.options).map(async (option) => {
        const providerId = option.value;
        const originalText = this.searchProviderOriginalTexts.get(providerId) || 'Unknown';

        // Special handling for "auto"
        if (providerId === 'auto') {
            option.text = originalText;
            option.disabled = false;
            return;
        }

        const isBackendProvider = ['gaode', 'tiansearch', 'cnsearch'].includes(providerId);

        // Handle overall backend fetch failure for backend providers
        if (isBackendProvider && backendFetchFailed) {
            option.text = `❌ ${originalText}`;
            // option.disabled = true; // Removed disabled state
            return;
        }

        let backendProvider = null;
        if (!backendFetchFailed) { // Only try to find if the fetch itself didn't fail
            backendProvider = backendProviders.find(bp => {
                // Map frontend IDs to backend names/IDs for backend-proxied services
                // Backend names are lowercase: 'gaode', 'tianmap', 'baidu'
                if (providerId === 'gaode' && bp.name === 'gaode') return true;
                if (providerId === 'tiansearch' && bp.name === 'tianmap') return true;
                if (providerId === 'cnsearch' && bp.name === 'baidu') return true;
                return false; // For frontend-only providers, this will be false
            });
        }

        // Handle loginRequired for backend-proxied providers (if backend fetch succeeded and provider found)
        // Backend property is 'login_required' (snake_case)
        if (backendProvider && backendProvider.login_required) {
            option.text = `🔒 ${originalText}`;
            return;
        } else if (backendProvider) { // If it's a backend provider, and not loginRequired
            // Assume "ok" status for now if no specific status from backend itself.
            option.text = `✅ ${originalText}`;
            return; // Done with this backend provider
        }

        // For frontend-only providers (nominatim, overpass, mapsearch, photon)
        // and any other provider not explicitly handled as a backend provider
        // if (!option.disabled) { // Condition no longer needed if not disabling
        option.text = `⏱️ ${originalText}`;
        // }

        const result = await this.testSearchProviderLatency(providerId);

        let icon = '❔';
        if (result.status === 'ok') {
            if (result.latency < 500) icon = '✅';
            else if (result.latency < 1500) icon = '👍';
            else icon = '⚠️';
        } else if (result.status === 'error') {
            icon = '❌';
        }

        option.text = `${icon} ${originalText}`;
        // option.disabled = (result.status === 'error'); // Removed disabled state
    });

    await Promise.all(promises);
    console.log("所有搜索服务商延迟测试完成。");
};

// --- Latency and Comment Features End ---

RoadbookApp.prototype.updateSearchInputState = function() {
    const searchInput = document.getElementById('searchInput');
    const currentMapConfig = this.mapSearchConfig[this.currentLayer];

    if (searchInput && currentMapConfig) {
        if (currentMapConfig.searchable) {
            // 启用搜索框
            searchInput.disabled = false;
            searchInput.placeholder = '搜索地点...';
            searchInput.style.opacity = '1';
        } else {
            // 禁用搜索框
            searchInput.disabled = true;
            searchInput.placeholder = `当前地图(${currentMapConfig.name})不支持搜索`;
            searchInput.style.opacity = '0.6';

            // 隐藏搜索结果
            const searchResults = document.getElementById('searchResults');
            if (searchResults) {
                searchResults.style.display = 'none';
            }
        }
    }
};

RoadbookApp.prototype.searchLocation = function(query) {
    if (!query.trim()) {
        // 隐藏搜索结果下拉框
        const searchResults = document.getElementById('searchResults');
        if (searchResults) {
            searchResults.style.display = 'none';
        }
        return;
    }

    this.fetchSearchResults(query)
        .then(data => {
            if (Array.isArray(data) && data.length > 0) {
                // Check if it's Photon GeoJSON features or standard list
                if (data[0].geometry && data[0].properties) {
                    this.showPhotonSearchResults(data);
                } else {
                    this.showSearchResults(data);
                }
            } else if (data && data.features && data.features.length > 0) {
                // Photon raw response
                this.showPhotonSearchResults(data.features);
            } else {
                // 没有找到结果，显示提示
                const searchResults = document.getElementById('searchResults');
                if (searchResults) {
                    const resultsList = document.getElementById('resultsList');
                    if (resultsList) {
                        resultsList.innerHTML = '<li style="padding: 12px 15px; color: #999; cursor: default;">未找到相关地点，请尝试其他关键词</li>';
                    }
                    searchResults.style.display = 'block';
                }
            }
        })
        .catch(error => {
            console.error('搜索地点时出错:', error);
            // 显示错误信息
            const searchResults = document.getElementById('searchResults');
            if (searchResults) {
                const resultsList = document.getElementById('resultsList');
                if (resultsList) {
                    let errorMessage = '搜索失败，请检查网络连接';

                    // 提取状态码
                    const statusMatch = error.message.match(/(\d{3})/);
                    const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

                    if (statusCode === 401) {
                        errorMessage = '搜索失败：未授权，请登录。';
                    } else if (statusCode === 403) {
                        errorMessage = '搜索失败：无权限，请检查API密钥或配置。';
                    } else if (statusCode === 400) {
                        errorMessage = '搜索失败：请求参数错误。';
                    } else if (statusCode === 404) {
                        errorMessage = '搜索失败：服务或资源未找到。';
                    } else if (error.message.includes('API Error')) {
                        const apiErrorMessage = error.message.replace(/Search API Error: |Overpass API Error: /, '');
                        errorMessage = `搜索失败：${apiErrorMessage}`;
                    } else if (error.message.includes('timeout') || error.name === 'AbortError') {
                        errorMessage = '搜索请求超时，请稍后再试。';
                    } else if (error.message === 'Search config error') {
                        errorMessage = '搜索方式配置错误';
                    } else if (error.message === 'Search not supported') {
                        errorMessage = '当前地图不支持搜索';
                    }

                    resultsList.innerHTML = `<li style="padding: 12px 15px; color: #999; cursor: default;">${errorMessage}</li>`;
                }
                searchResults.style.display = 'block';
            }
        });
};

// AI Helper: Search location and return data
RoadbookApp.prototype.aiSearchLocation = async function(query) {
    try {
        const results = await this.fetchSearchResults(query);
        let formattedResults = [];

        if (Array.isArray(results)) {
            if (results.length > 0 && results[0].geometry && results[0].properties) {
                // Photon/GeoJSON features
                formattedResults = results.slice(0, 3).map(f => ({
                    name: f.properties.name || f.properties.street || 'Unknown',
                    lat: f.geometry.coordinates[1],
                    lng: f.geometry.coordinates[0],
                    address: [f.properties.city, f.properties.country].filter(Boolean).join(', ')
                }));
            } else {
                // Standard results
                formattedResults = results.slice(0, 3).map(r => ({
                    name: r.display_name || r.name,
                    lat: parseFloat(r.lat),
                    lng: parseFloat(r.lon),
                    type: r.type
                }));
            }
        } else if (results && results.features) {
            // Photon raw response
            formattedResults = results.features.slice(0, 3).map(f => ({
                name: f.properties.name || f.properties.street || 'Unknown',
                lat: f.geometry.coordinates[1],
                lng: f.geometry.coordinates[0],
                address: [f.properties.city, f.properties.country].filter(Boolean).join(', ')
            }));
        }

        return formattedResults;
    } catch (e) {
        console.error('AI Search failed:', e);
        return [];
    }
};

// 核心搜索逻辑，返回Promise
RoadbookApp.prototype.fetchSearchResults = async function(query) {
    // 使用当前选择的搜索方法
    let searchConfig;

    if (this.currentSearchMethod === 'auto') {
        // 自动模式：检查当前地图是否支持搜索
        const currentMapConfig = this.mapSearchConfig[this.currentLayer];
        if (!currentMapConfig || !currentMapConfig.searchable) {
            return Promise.reject(new Error('Search not supported'));
        }
        searchConfig = currentMapConfig;
    } else if (this.currentSearchMethod === 'nominatim') {
        // Nominatim搜索模式
        searchConfig = {
            searchable: true,
            searchUrl: 'https://nominatim.openstreetmap.org/search',
            params: {
                format: 'json',
                limit: 10
            },
            parser: 'nominatim',
            name: 'Nominatim'
        };
    } else if (this.currentSearchMethod === 'overpass') {
        // Overpass搜索模式
        searchConfig = {
            searchable: true,
            searchUrl: 'https://overpass-api.de/api/interpreter',
            parser: 'overpass',
            name: 'Overpass'
        };
    } else if (this.currentSearchMethod === 'photon') {
        // Photon搜索模式（原Google搜索）
        searchConfig = {
            searchable: true,
            searchUrl: 'https://photon.komoot.io/api/',
            params: {
                limit: 10
            },
            parser: 'photon',
            name: 'Photon'
        };
    } else if (this.currentSearchMethod === 'mapsearch') {
        // MapSearch搜索模式
        searchConfig = {
            searchable: true,
            searchUrl: 'https://map.011203.dpdns.org/search',
            params: {
                format: 'json',
                limit: 10
            },
            parser: 'nominatim', // 使用Nominatim格式，因为MapSearch与Nominatim格式一致
            name: 'MapSearch'
        };
    } else if (this.currentSearchMethod === 'gaode') {
        // Gaode Search
        searchConfig = {
            searchable: true,
            searchUrl: apiBaseUrl + '/api/gaode/search',
            params: {
                format: 'json',
                limit: 10
            },
            parser: 'nominatim',
            name: '高德'
        };
    } else if (this.currentSearchMethod === 'cnsearch') {
        // CNSearch搜索模式
        searchConfig = {
            searchable: true,
            searchUrl: apiBaseUrl + '/api/cnmap/search',
            params: {
                format: 'json',
                limit: 10
            },
            parser: 'nominatim', // 使用Nominatim格式，因为CNSearch与Nominatim格式一致
            name: '百度'
        };
    } else if (this.currentSearchMethod === 'tiansearch') {
        // TianSearch搜索模式
        searchConfig = {
            searchable: true,
            searchUrl: apiBaseUrl + '/api/tianmap/search',
            params: {
                format: 'json',
                limit: 10
            },
            parser: 'nominatim', // 使用Nominatim格式，因为TianSearch与Nominatim格式一致
            name: '天地图'
        };
    } else {
        return Promise.reject(new Error('Search config error'));
    }

    let url;

    if (searchConfig.parser === 'overpass') {
        // 构建Overpass API查询 - 使用英文搜索
        const overpassQuery = `[out:json];(
            node['name:en'~'${query}',i]['place'~'city|town|village'];
            node['name:zh'~'${query}',i]['place'~'city|town|village'];
            node['name'~'${query}',i]['place'~'city|town|village'];
            way['name:en'~'${query}',i]['place'~'city|town|village'];
            way['name:zh'~'${query}',i]['place'~'city|town|village'];
            way['name'~'${query}',i]['place'~'city|town|village'];
            relation['name:en'~'${query}',i]['place'~'city|town|village'];
            relation['name:zh'~'${query}',i]['place'~'city|town|village'];
            relation['name'~'${query}',i]['place'~'city|town|village'];
        );out center;`;

        url = `${searchConfig.searchUrl}?data=${encodeURIComponent(overpassQuery)}`;
        const response = await fetch(url);
        if (!response.ok) {
            try {
                const errData = await response.json();
                throw new Error(`Overpass API Error: ${response.status} ${errData.message || response.statusText}`);
            } catch {
                throw new Error(`Overpass API Error: ${response.status} ${response.statusText}`);
            }
        }
        const data = await response.json();
        if (data && data.elements && data.elements.length > 0) {
            return this.convertOverpassToSearchResults(data.elements);
        }
        return [];
    } else {
        // 原有的Nominatim/Photon/Backend search logic
        const params = new URLSearchParams({
            ...searchConfig.params,
            q: query
        });

        // Prepare headers, including Authorization if JWT token exists
        const headers = {
            'Content-Type': 'application/json',
        };
        const jwtToken = localStorage.getItem('online_token');
        if (jwtToken) {
            headers['Authorization'] = `Bearer ${jwtToken}`;
        }

        url = `${searchConfig.searchUrl}?${params.toString()}`;
        const response_1 = await fetch(url, {headers});
        if (!response_1.ok) {
            try {
                const errData_1 = await response_1.json();
                throw new Error(`${searchConfig.name || 'Search'} API Error: ${response_1.status} ${errData_1.message || errData_1.error || response_1.statusText}`);
            } catch {
                throw new Error(`${searchConfig.name || 'Search'} API Error: ${response_1.status} ${response_1.statusText}`);
            }
        }
        return await response_1.json();
    }
};

// 显示Photon搜索结果下拉框
RoadbookApp.prototype.showPhotonSearchResults = function(features) {
    const searchResults = document.getElementById('searchResults');
    const resultsList = document.getElementById('resultsList');

    if (!searchResults || !resultsList) return;

    // 清空现有结果
    resultsList.innerHTML = '';

    // 添加搜索结果到列表
    features.forEach((feature) => {
        const li = document.createElement('li');
        const name = feature.properties.name || feature.properties.street || '未知地点';
        const city = feature.properties.city || '';
        const country = feature.properties.country || '';

        let address = '';
        if (city && country) {
            address = `${city}, ${country}`;
        } else if (city) {
            address = city;
        } else if (country) {
            address = country;
        }

        li.innerHTML = `
            <div class="result-title">${name}</div>
            <div class="result-address">${address || '地点'}</div>
        `;

        // 添加点击事件
        li.addEventListener('click', () => {
            this.selectPhotonSearchResult(feature);
        });

        resultsList.appendChild(li);
    });

    // 显示搜索结果下拉框
    searchResults.style.display = 'block';
};

// 选择Photon搜索结果
RoadbookApp.prototype.selectPhotonSearchResult = function(feature) {
    const coordinates = feature.geometry.coordinates;
    const lat = coordinates[1];
    const lon = coordinates[0];

    if (!isNaN(lat) && !isNaN(lon)) {
        // 聚焦到搜索结果位置
        this.map.setView([lat, lon], 15); // 缩放级别15适合城市级别

        // 在搜索结果位置添加一个临时标记点来显示结果
        if (this.searchMarker) {
            this.map.removeLayer(this.searchMarker);
        }

        const name = feature.properties.name || feature.properties.street || '搜索结果';
        this.searchMarker = L.marker([lat, lon])
            .addTo(this.map)
            .bindPopup(name)
            .openPopup();

        // 添加点击事件以聚焦视图
        this.searchMarker.on('click', () => {
            this.map.setView([lat, lon], 15);
        });

        // 3秒后自动关闭弹窗
        if (this.searchPopupTimeout) {
            clearTimeout(this.searchPopupTimeout);
        }
        this.searchPopupTimeout = setTimeout(() => {
            if (this.searchMarker) {
                this.map.closePopup(this.searchMarker.getPopup());
            }
            this.searchPopupTimeout = null;
        }, 3000);

        // 隐藏搜索结果下拉框
        const searchResults = document.getElementById('searchResults');
        if (searchResults) {
            searchResults.style.display = 'none';
        }

        console.log(`已选择Photon搜索结果: ${name} (${lat}, ${lon})`);
    } else {
        this.showSwalAlert('错误', '未能获取有效的地理位置信息', 'error');
    }
};

// 转换Overpass API结果为标准格式
RoadbookApp.prototype.convertOverpassToSearchResults = function(elements) {
    return elements.map(element => {
        let lat, lon, name, display_name;

        if (element.type === 'node') {
            lat = element.lat;
            lon = element.lon;
        } else if (element.type === 'way' || element.type === 'relation') {
            // 对于way和relation，使用center坐标
            if (element.center) {
                lat = element.center.lat;
                lon = element.center.lon;
            }
        }

        // 获取名称
        if (element.tags) {
            name = element.tags.name || element.tags['name:zh'] || element.tags['name:en'] || '未知地点';

            // 构建显示名称
            display_name = name;
            if (element.tags['addr:city']) {
                display_name += `, ${element.tags['addr:city']}`;
            }
            if (element.tags['addr:country']) {
                display_name += `, ${element.tags['addr:country']}`;
            }
        }

        return {
            lat: lat,
            lon: lon,
            display_name: display_name || name,
            name: name,
            type: element.tags && element.tags.place ? element.tags.place : 'unknown'
        };
    }).filter(result => result.lat && result.lon); // 只保留有坐标的结果
};

// 显示搜索结果下拉框
RoadbookApp.prototype.showSearchResults = function(results) {
    const searchResults = document.getElementById('searchResults');
    const resultsList = document.getElementById('resultsList');

    if (!searchResults || !resultsList) return;

    // 清空现有结果
    resultsList.innerHTML = '';

    // 添加搜索结果到列表
    results.forEach((result) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="result-title">${result.display_name}</div>
            <div class="result-address">${result.type || result.class || '地点'}</div>
        `;

        // 添加点击事件
        li.addEventListener('click', () => {
            this.selectSearchResult(result);
        });

        resultsList.appendChild(li);
    });

    // 显示搜索结果下拉框
    searchResults.style.display = 'block';
};

// 选择搜索结果
RoadbookApp.prototype.selectSearchResult = function(result) {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);

    if (!isNaN(lat) && !isNaN(lon)) {
        // 聚焦到搜索结果位置
        this.map.setView([lat, lon], 15); // 缩放级别15适合城市级别

        // 在搜索结果位置添加一个临时标记点来显示结果
        if (this.searchMarker) {
            this.map.removeLayer(this.searchMarker);
        }

        this.searchMarker = L.marker([lat, lon])
            .addTo(this.map)
            .bindPopup(result.display_name)
            .openPopup();

        // 添加点击事件以聚焦视图
        this.searchMarker.on('click', () => {
            this.map.setView([lat, lon], 15);
        });

        // 3秒后自动关闭弹窗
        if (this.searchPopupTimeout) {
            clearTimeout(this.searchPopupTimeout);
        }
        this.searchPopupTimeout = setTimeout(() => {
            if (this.searchMarker) {
                this.map.closePopup(this.searchMarker.getPopup());
            }
            this.searchPopupTimeout = null;
        }, 3000);

        // 隐藏搜索结果下拉框
        const searchResults = document.getElementById('searchResults');
        if (searchResults) {
            searchResults.style.display = 'none';
        }

        console.log(`已选择搜索结果: ${result.display_name} (${lat}, ${lon})`);
    } else {
        this.showSwalAlert('错误', '未能获取有效的地理位置信息', 'error');
    }
};
