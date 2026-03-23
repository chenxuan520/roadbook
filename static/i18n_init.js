async function initI18n() {
    // 1. Try to read from localStorage
    let savedLang = localStorage.getItem('roadbook-lang');

    // 2. If not saved, guess from browser language
    if (!savedLang) {
        const browserLang = navigator.language || navigator.userLanguage || '';
        // If it starts with 'en' use 'en', otherwise default to 'zh' (Chinese)
        savedLang = browserLang.toLowerCase().startsWith('en') ? 'en' : 'zh';
    }

    await i18next.init({
        lng: savedLang,
        fallbackLng: 'zh',
        resources: window.roadbookLocales,
        debug: false
    });

    // Initialize loc-i18next for automatic DOM text replacement
    window.localizeDOM = locI18next.init(i18next, {
        optionsAttr: 'data-i18n-options',
        useOptionsAttr: true
    });

    // Perform initial replacement
    updatePageLanguage();
}

function updatePageLanguage() {
    if (window.localizeDOM) {
        window.localizeDOM('body');
    }
    document.documentElement.lang = i18next.language;
    // Dispatch a custom event in case other components need to react
    window.dispatchEvent(new Event('languageChanged'));
}

window.changeLanguage = function(lang) {
    if (!i18next) return;
    i18next.changeLanguage(lang).then(() => {
        localStorage.setItem('roadbook-lang', lang);
        updatePageLanguage();
    });
};

// Toggle language dropdown manually if necessary, reusing existing dropdown logic
// Or simply let CSS hover handles it if it's set to hover, 
// but wait, standard dropdown in this app seems to be click-based.
// Actually, let's attach click handlers if we need to. 

document.addEventListener('DOMContentLoaded', () => {
    initI18n();

    // Attach click handler for the language dropdown button
    const langDropdownBtn = document.getElementById('langDropdownBtn');
    if (langDropdownBtn) {
        langDropdownBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const content = this.nextElementSibling;
            content.classList.toggle('show');
        });
    }
});

// Close dropdowns when clicking outside
window.addEventListener('click', function(e) {
    if (!e.target.matches('.dropdown-btn') && !e.target.closest('.dropdown-btn')) {
        const dropdowns = document.getElementsByClassName('dropdown-content');
        for (let i = 0; i < dropdowns.length; i++) {
            const openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show')) {
                openDropdown.classList.remove('show');
            }
        }
    }
});
