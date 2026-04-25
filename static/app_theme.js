// app_theme.js - 主题管理方法
// 必须在 script.js 之后、DOMContentLoaded 之前加载

RoadbookApp.prototype.initTheme = function() {
    const savedTheme = localStorage.getItem('roadbook-theme');
    if (savedTheme) {
        // 如果有保存的设置，则使用它
        if (savedTheme === 'dark') {
            this.enableDarkMode();
        } else {
            this.enableLightMode();
        }
    } else {
        // 否则，追随系统设置
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            this.enableDarkMode();
        } else {
            this.enableLightMode();
        }
    }
};

RoadbookApp.prototype.toggleTheme = function() {
    if (this.isDarkMode) {
        this.enableLightMode();
    } else {
        this.enableDarkMode();
    }
};

RoadbookApp.prototype.enableDarkMode = function() {
    document.body.classList.add('dark-mode');
    this.isDarkMode = true;
    localStorage.setItem('roadbook-theme', 'dark');
    this.updateThemeIcon();
};

RoadbookApp.prototype.enableLightMode = function() {
    document.body.classList.remove('dark-mode');
    this.isDarkMode = false;
    localStorage.setItem('roadbook-theme', 'light');
    this.updateThemeIcon();
};

RoadbookApp.prototype.updateThemeIcon = function() {
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) {
        themeIcon.textContent = this.isDarkMode ? '🌙' : '☀️';
    }
};
