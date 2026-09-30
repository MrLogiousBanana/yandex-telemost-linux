const { app, BrowserWindow, session, desktopCapturer, shell } = require("electron");
const path = require("path");

// Crucial: app.name MUST be ASCII so X11 WM_CLASS matches yandex-telemost.desktop
app.name = "yandex-telemost";

let mainWindow = null;

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * Unwraps redirect wrappers (like sba.yandex.net/redirect?url=...) and strips
 * custom protocol prefixes (telemost://ychat/, telemost://, telemost:, ychat://, ychat:).
 */
function extractRawTargetUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    let clean = rawUrl.trim();

    // 1. Check if this is an HTTP(S) redirect wrapper with a ?url= parameter
    if (clean.startsWith("http://") || clean.startsWith("https://")) {
        try {
            const parsed = new URL(clean);
            const embeddedUrl = parsed.searchParams.get("url") || parsed.searchParams.get("retpath");
            if (embeddedUrl && (embeddedUrl.includes("telemost") || embeddedUrl.includes("/j/") || embeddedUrl.includes("%2Fj%2F"))) {
                clean = embeddedUrl.trim();
            }
        } catch (e) {}
    }

    // 2. Strip custom protocol and ychat prefixes iteratively
    const stripPrefixes = (str) => {
        let s = str;
        let changed = true;
        while (changed) {
            changed = false;
            for (const prefix of [
                "telemost://ychat/",
                "telemost:ychat/",
                "telemost://",
                "telemost:",
                "ychat://",
                "ychat:",
                "ychat/"
            ]) {
                if (s.startsWith(prefix)) {
                    s = s.slice(prefix.length);
                    changed = true;
                }
            }
        }
        return s;
    };

    clean = stripPrefixes(clean);

    // 3. Decode percent-encoding if needed (e.g. telemost://https%3A%2F%2F...)
    if (!clean.startsWith("http://") && !clean.startsWith("https://") && (clean.includes("%3A") || clean.includes("%2F") || clean.includes("%3a") || clean.includes("%2f"))) {
        try {
            clean = decodeURIComponent(clean);
        } catch (e) {}
        clean = stripPrefixes(clean);
    }

    return clean;
}

/**
 * Extracts meeting ID from any URL or deeplink (e.g. /j/1234567890 -> 1234567890)
 */
function getMeetingId(url) {
    const clean = extractRawTargetUrl(url);
    if (!clean) return null;
    const match = clean.match(/\/j\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    if (/^\d{10,}$/.test(clean)) return clean;
    return null;
}

/**
 * Determines whether to use telemost.360.yandex.ru (B2B / Yandex 360) or telemost.yandex.ru
 * so that navigating to a meeting never triggers a disruptive cross-domain Legal redirect.
 */
function getPreferredTelemostOrigin(hintUrl) {
    if (hintUrl && typeof hintUrl === "string" && (hintUrl.includes("telemost.360.yandex.") || hintUrl.includes("360.yandex."))) {
        return "https://telemost.360.yandex.ru";
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            const currentUrl = mainWindow.webContents.getURL();
            if (currentUrl && currentUrl.includes("telemost.360.yandex.")) {
                return "https://telemost.360.yandex.ru";
            }
        } catch (e) {}
    }
    return "https://telemost.yandex.ru";
}

/**
 * Normalizes any incoming Telemost meeting argument or URL into a direct
 * canonical https://telemost(.360).yandex.ru/j/<id>?skip_app=1 URL.
 */
function normalizeMeetingUrl(rawUrl) {
    const origin = getPreferredTelemostOrigin(rawUrl);
    if (!rawUrl || typeof rawUrl !== "string") return origin + "/";

    const clean = extractRawTargetUrl(rawUrl);
    const meetingId = getMeetingId(clean);

    if (meetingId) {
        const targetOrigin = getPreferredTelemostOrigin(clean);
        return `${targetOrigin}/j/${meetingId}?skip_app=1`;
    }

    let target;
    if (clean.startsWith("http://") || clean.startsWith("https://")) {
        target = clean;
    } else if (clean.startsWith("telemost.yandex.") || clean.startsWith("360.yandex.") || clean.startsWith("telemost.360.yandex.")) {
        target = "https://" + clean;
    } else {
        target = origin + "/" + clean.replace(/^\/+/, "");
    }

    try {
        const u = new URL(target);
        if (u.pathname.includes("/j/")) {
            u.searchParams.set("skip_app", "1");
        }
        return u.toString();
    } catch (e) {
        return target;
    }
}

/**
 * Checks if a CLI argument is a Telemost URL or meeting link
 */
function isCliMeetingArg(arg) {
    if (!arg || typeof arg !== "string") return false;
    if (arg.includes("node_modules") || arg.endsWith(".js") || arg.startsWith("/opt/") || arg.startsWith("-")) {
        return false;
    }
    return (
        arg.startsWith("telemost:") ||
        arg.startsWith("ychat:") ||
        arg.includes("telemost.yandex.") ||
        arg.includes("telemost.360.yandex.") ||
        arg.includes("360.yandex.ru/telemost") ||
        Boolean(getMeetingId(arg))
    );
}

/**
 * Opens a normalized meeting URL in mainWindow unless that exact meeting is already open
 */
function openMeetingInMainWindow(rawUrl) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();

    const targetUrl = normalizeMeetingUrl(rawUrl);
    const currentUrl = mainWindow.webContents.getURL();
    const targetId = getMeetingId(targetUrl);
    const currentId = getMeetingId(currentUrl);

    if (!targetId || targetId !== currentId) {
        mainWindow.loadURL(targetUrl);
    }
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on("second-instance", (event, commandLine) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();

            const meetingArg = commandLine.find(isCliMeetingArg);
            if (meetingArg) {
                openMeetingInMainWindow(meetingArg);
            }
        }
    });
}

/**
 * Attaches navigation, window creation, and protocol handlers to WebContents
 */
function setupWebContentsNavigation(contents) {
    // Intercept in-page HTTP / link navigations
    contents.on("will-navigate", (event, navUrl) => {
        if (navUrl.startsWith("telemost:") || navUrl.startsWith("ychat:")) {
            event.preventDefault();
            openMeetingInMainWindow(navUrl);
            return;
        }

        const isMain = mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents;
        const meetingId = getMeetingId(navUrl);

        if (meetingId) {
            if (!isMain) {
                // A popup window (e.g. Calendar) is navigating to a meeting link -> route to mainWindow
                event.preventDefault();
                openMeetingInMainWindow(navUrl);
                return;
            }

            try {
                const u = new URL(navUrl);
                const preferredOrigin = getPreferredTelemostOrigin(navUrl);
                if (u.searchParams.get("skip_app") !== "1" || u.origin !== preferredOrigin) {
                    event.preventDefault();
                    mainWindow.loadURL(normalizeMeetingUrl(navUrl));
                }
            } catch (e) {}
        }
    });

    // Intercept window.open / target="_blank"
    contents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("telemost:") || url.startsWith("ychat:") || getMeetingId(url)) {
            openMeetingInMainWindow(url);
            return { action: "deny" };
        }

        if (url.includes("passport.yandex.") || url.includes("id.yandex.")) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.loadURL(url);
            }
            return { action: "deny" };
        }

        if (url.includes("telemost.yandex.") || url.includes("telemost.360.yandex.") || url.includes("360.yandex.ru/telemost")) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.loadURL(normalizeMeetingUrl(url));
            }
            return { action: "deny" };
        }

        if (url.includes("yandex.ru") || url.includes("yandex.net") || url.includes("ya.ru") || url.includes("yandex.com")) {
            return { action: "allow" };
        }

        shell.openExternal(url);
        return { action: "deny" };
    });
}

function createWindow() {
    const ses = session.defaultSession;

    // Auto-approve WebRTC media permissions
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = [
            "media",
            "notifications",
            "display-capture",
            "pointerLock",
            "fullscreen",
            "clipboard-read",
            "clipboard-sanitized-write"
        ];
        callback(allowedPermissions.includes(permission));
    });

    ses.setPermissionCheckHandler(() => {
        return true;
    });

    // Handle screen sharing requests
    ses.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ["screen", "window"] }).then((sources) => {
            if (sources.length > 0) {
                callback({ video: sources[0] });
            } else {
                callback({});
            }
        }).catch((err) => {
            console.error("Error in desktopCapturer:", err);
            callback({});
        });
    });

    // Persist session cookies across restarts
    ses.cookies.on("changed", (event, cookie, cause, removed) => {
        if (!removed && cookie.session && (cookie.domain.includes("yandex") || cookie.domain.includes("ya.ru"))) {
            const domain = cookie.domain.startsWith(".") ? cookie.domain.substring(1) : cookie.domain;
            const protocol = cookie.secure ? "https:" : "http:";
            const url = `${protocol}//${domain}${cookie.path}`;
            const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);

            ses.cookies.set({
                url: url,
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path,
                secure: cookie.secure,
                httpOnly: cookie.httpOnly,
                sameSite: cookie.sameSite,
                expirationDate: oneYearFromNow
            }).then(() => {
                ses.cookies.flushStore().catch(() => {});
            }).catch(() => {});
        }
    });

    mainWindow = new BrowserWindow({
        title: "Яндекс Телемост",
        icon: path.join(__dirname, "icon.png"),
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 550,
        backgroundColor: "#161616",
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: true,
            backgroundThrottling: false
        }
    });

    mainWindow.webContents.setUserAgent(USER_AGENT);

    // If meeting URL passed via CLI, open it normalized, else home page
    let startUrl = "https://telemost.yandex.ru/";
    const args = process.argv.slice(1);
    const meetingArg = args.find(isCliMeetingArg);
    if (meetingArg) {
        startUrl = normalizeMeetingUrl(meetingArg);
    }

    mainWindow.loadURL(startUrl);

    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
    });

    const flushSession = async () => {
        try {
            await ses.cookies.flushStore();
            await ses.flushStorageData();
        } catch (e) {}
    };

    mainWindow.on("close", async () => {
        await flushSession();
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

// Hook into all web contents (main window, popups, frames)
app.on("web-contents-created", (event, contents) => {
    setupWebContentsNavigation(contents);
});

app.whenReady().then(() => {
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient("telemost", process.execPath, [path.resolve(process.argv[1])]);
        }
    } else {
        app.setAsDefaultProtocolClient("telemost");
    }

    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("before-quit", async () => {
    try {
        await session.defaultSession.cookies.flushStore();
        await session.defaultSession.flushStorageData();
    } catch (e) {}
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
