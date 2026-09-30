// Telemost Desktop Preload
(() => {
    const patchStorageObject = (raw) => {
        if (!raw || typeof raw !== 'string' || !raw.startsWith('{')) return null;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                if (
                    'openInAppDeeplinksEnabled' in parsed ||
                    'openDeeplinksInTelemostApp' in parsed ||
                    'migrated' in parsed ||
                    'disableCameraInGroupCalls' in parsed
                ) {
                    if (parsed.openInAppDeeplinksEnabled !== false || parsed.openDeeplinksInTelemostApp !== false) {
                        parsed.openInAppDeeplinksEnabled = false;
                        parsed.openDeeplinksInTelemostApp = false;
                        return JSON.stringify(parsed);
                    }
                }
            }
        } catch (e) {}
        return null;
    };

    const sanitizeLocalStorage = () => {
        try {
            for (let i = 0; i < window.localStorage.length; i++) {
                const key = window.localStorage.key(i);
                if (!key) continue;
                const val = window.localStorage.getItem(key);
                const updated = patchStorageObject(val);
                if (updated !== null) {
                    window.localStorage.setItem(key, updated);
                }
            }
        } catch (e) {}
    };

    sanitizeLocalStorage();

    const mainWorldCode = `
    (() => {
        const patchObj = (raw) => {
            if (!raw || typeof raw !== 'string' || !raw.startsWith('{')) return raw;
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    if (
                        'openInAppDeeplinksEnabled' in parsed ||
                        'openDeeplinksInTelemostApp' in parsed ||
                        'migrated' in parsed ||
                        'disableCameraInGroupCalls' in parsed
                    ) {
                        parsed.openInAppDeeplinksEnabled = false;
                        parsed.openDeeplinksInTelemostApp = false;
                        return JSON.stringify(parsed);
                    }
                }
            } catch (e) {}
            return raw;
        };

        try {
            const origGetItem = Storage.prototype.getItem;
            Storage.prototype.getItem = function(key) {
                const val = origGetItem.call(this, key);
                if (this === window.localStorage) {
                    return patchObj(val);
                }
                return val;
            };

            const origSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, val) {
                if (this === window.localStorage && typeof val === 'string') {
                    val = patchObj(val);
                }
                return origSetItem.call(this, key, val);
            };
        } catch (e) {}

        // Suppress recursive telemost:// or ychat:// protocol jumps from within the web app
        try {
            const origAssign = window.location.assign.bind(window.location);
            window.location.assign = function(url) {
                if (typeof url === 'string' && (url.startsWith('telemost:') || url.startsWith('ychat:'))) {
                    return;
                }
                return origAssign(url);
            };

            const origReplace = window.location.replace.bind(window.location);
            window.location.replace = function(url) {
                if (typeof url === 'string' && (url.startsWith('telemost:') || url.startsWith('ychat:'))) {
                    return;
                }
                return origReplace(url);
            };
        } catch (e) {}
    })();
    `;

    const injectMainWorldScript = () => {
        const root = document.head || document.documentElement;
        if (!root) return false;
        try {
            const script = document.createElement('script');
            script.textContent = mainWorldCode;
            root.appendChild(script);
            script.remove();
            return true;
        } catch (e) {
            return false;
        }
    };

    if (!injectMainWorldScript()) {
        const docObserver = new MutationObserver(() => {
            if (injectMainWorldScript()) {
                docObserver.disconnect();
            }
        });
        docObserver.observe(document, { childList: true });
    }

    window.addEventListener('DOMContentLoaded', () => {
        sanitizeLocalStorage();

        // 1. Native styles & desktop app promo banner suppression
        const style = document.createElement('style');
        style.id = 'telemost-native-tweaks';
        style.textContent = `
            /* System fonts & Emoji */
            body, button, input, select, textarea {
                font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Noto Color Emoji" !important;
            }

            /* Hide download desktop app promo banners since we are in the desktop app */
            [class*="desktopAppBanner"],
            [class*="download-app"],
            [class*="DesktopAppBanner"],
            [class*="NativeAppBanner"],
            [class*="desktop-app-banner"] {
                display: none !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);

        // 2. Safety net: if "continue in browser" prompt ever mounts, click continue immediately
        const clickContinueIfPresent = () => {
            const continueBtn = document.querySelector('[data-test-id="meeting-continue-in-browser-continue"]');
            if (continueBtn) {
                continueBtn.click();
            }
        };

        clickContinueIfPresent();

        const observer = new MutationObserver(() => {
            clickContinueIfPresent();
        });

        if (document.documentElement) {
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        }
    });
})();
