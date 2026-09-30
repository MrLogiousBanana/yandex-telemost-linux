const { app, BrowserWindow, session, desktopCapturer, shell } = require("electron");
const path = require("path");

// Crucial: app.name MUST be ASCII so X11 WM_CLASS matches yandex-telemost.desktop
app.name = "yandex-telemost";

let mainWindow = null;

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * Extracts meeting ID from URL (e.g. /j/1234567890 -> 1234567890)
 */
function getMeetingId(url) {
    if (!url || typeof url !== "string") return null;
    const match = url.match(/\/j\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

/**
 * Normalizes any incoming Telemost meeting argument or URL.
 * Handles:
 * - telemost://https://telemost.yandex.ru/j/<id>
 * - telemost:https://telemost.yandex.ru/j/<id>
 * - telemost://telemost.yandex.ru/j/<id>
 * - telemost://j/<id>
 * - telemost:<meetingId>
 * - telemost://<meetingId>
 * - https://telemost.yandex.ru/j/<id>
 * - https://360.yandex.ru/telemost/j/<id>
 * Ensures skip_app=1 is added so web client bypasses browser detection.
 */
function normalizeMeetingUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "https://telemost.yandex.ru/";
    let clean = rawUrl.trim();

    try {
        if (clean.includes("%3A") || clean.includes("%2F") || clean.includes("%3a") || clean.includes("%2f")) {
            clean = decodeURIComponent(clean);
        }
    } catch (e) {}

    while (clean.startsWith("telemost://") || clean.startsWith("telemost:")) {
        clean = clean.startsWith("telemost://") ? clean.slice(11) : clean.slice(9);
    }

    let target;
    if (clean.startsWith("http://") || clean.startsWith("https://")) {
        target = clean;
    } else if (clean.startsWith("telemost.yandex.") || clean.startsWith("360.yandex.") || clean.startsWith("telemost.360.yandex.")) {
        target = "https://" + clean;
    } else if (clean.startsWith("j/") || clean.startsWith("/j/")) {
        target = "https://telemost.yandex.ru/" + clean.replace(/^\/+/, "");
    } else if (/^[a-zA-Z0-9_-]+$/.test(clean) && !clean.includes("/") && !clean.includes(".")) {
        target = "https://telemost.yandex.ru/j/" + clean;
    } else {
        target = "https://telemost.yandex.ru/" + clean.replace(/^\/+/, "");
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

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on("second-instance", (event, commandLine, workingDirectory) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();

            const meetingArg = commandLine.find(arg =>
                arg.startsWith("telemost:") ||
                arg.includes("telemost.yandex.ru/j/") ||
                arg.includes("360.yandex.ru/telemost/j/") ||
                (arg.includes("/j/") && !arg.includes("node_modules") && !arg.includes(".js") && !arg.includes("/opt/"))
            );
            if (meetingArg) {
                const targetUrl = normalizeMeetingUrl(meetingArg);
                const currentUrl = mainWindow.webContents.getURL();
                const targetId = getMeetingId(targetUrl);
                const currentId = getMeetingId(currentUrl);
                if (!targetId || targetId !== currentId) {
                    mainWindow.loadURL(targetUrl);
                }
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
        if (navUrl.startsWith("telemost:")) {
            event.preventDefault();
            if (contents === (mainWindow && mainWindow.webContents)) {
                const target = normalizeMeetingUrl(navUrl);
                const currentUrl = mainWindow.webContents.getURL();
                const targetId = getMeetingId(target);
                const currentId = getMeetingId(currentUrl);
                if (!targetId || targetId !== currentId) {
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    mainWindow.focus();
                    mainWindow.loadURL(target);
                }
            }
            return;
        }

        if (contents === (mainWindow && mainWindow.webContents) && navUrl.includes("/j/") && (navUrl.includes("telemost.yandex.") || navUrl.includes("360.yandex."))) {
            try {
                const u = new URL(navUrl);
                if (u.searchParams.get("skip_app") !== "1") {
                    event.preventDefault();
                    contents.loadURL(normalizeMeetingUrl(navUrl));
                }
            } catch (e) {}
        }
    });

    // Intercept window.open / target="_blank"
    contents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("telemost:")) {
            const target = normalizeMeetingUrl(url);
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.focus();
                const targetId = getMeetingId(target);
                const currentId = getMeetingId(mainWindow.webContents.getURL());
                if (!targetId || targetId !== currentId) {
                    mainWindow.loadURL(target);
                }
            }
            return { action: "deny" };
        }

        if (url.includes("passport.yandex.") || url.includes("id.yandex.")) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.loadURL(url);
            }
            return { action: "deny" };
        }

        if ((url.includes("telemost.yandex.") || url.includes("telemost.360.yandex.") || url.includes("360.yandex.ru/telemost")) && url.includes("/j/")) {
            const target = normalizeMeetingUrl(url);
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.focus();
                const targetId = getMeetingId(target);
                const currentId = getMeetingId(mainWindow.webContents.getURL());
                if (!targetId || targetId !== currentId) {
                    mainWindow.loadURL(target);
                }
            }
            return { action: "deny" };
        }

        if (url.includes("telemost.yandex.") || url.includes("telemost.360.yandex.") || url.includes("360.yandex.ru/telemost")) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.loadURL(url);
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

    ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
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
    const meetingArg = args.find(arg =>
        arg.startsWith("telemost:") ||
        arg.includes("telemost.yandex.ru/j/") ||
        arg.includes("360.yandex.ru/telemost/j/") ||
        (arg.includes("/j/") && !arg.includes("node_modules") && !arg.includes(".js") && !arg.includes("/opt/"))
    );
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
