// Telemost Desktop Preload
(() => {
    try {
        const script = document.createElement('script');
        script.textContent = `
        (() => {
            // Suppress recursive telemost:// protocol jumps from within the web app
            const origAssign = window.location.assign.bind(window.location);
            window.location.assign = function(url) {
                if (typeof url === 'string' && url.startsWith('telemost:')) {
                    return;
                }
                return origAssign(url);
            };

            const origReplace = window.location.replace.bind(window.location);
            window.location.replace = function(url) {
                if (typeof url === 'string' && url.startsWith('telemost:')) {
                    return;
                }
                return origReplace(url);
            };
        })();
        `;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    } catch (e) {
        console.error('Telemost preload main-world injection error:', e);
    }
})();

window.addEventListener('DOMContentLoaded', () => {
    // 1. Native styles & promos & prompt suppression
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

        /* Hide continue-in-browser interstitial prompt if it ever tries to render */
        [data-test-tag="meeting-continue-in-browser"],
        .yamb-meeting-continue-in-browser {
            display: none !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);

    // 2. Safety net MutationObserver: if the modal ever mounts, auto-click "Продолжить в браузере"
    const observer = new MutationObserver(() => {
        const continueBtn = document.querySelector('[data-test-id="meeting-continue-in-browser-continue"]');
        if (continueBtn) {
            continueBtn.click();
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
});
