window.addEventListener('DOMContentLoaded', () => {
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
    document.head.appendChild(style);
});
