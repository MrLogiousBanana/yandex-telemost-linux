const { app, BrowserWindow, session, desktopCapturer, shell } = require('electron');
const path = require('path');

app.name = 'yandex-telemost';

let mainWindow = null;

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();

            const meetingArg = commandLine.find(arg => arg.startsWith('telemost:') || arg.includes('telemost.yandex.ru/j/'));
            if (meetingArg) {
                const targetUrl = meetingArg.replace(/^telemost:\/\//, 'https://').replace(/^telemost:/, 'https:');
                mainWindow.loadURL(targetUrl);
            }
        }
    });
}

function createWindow() {
    const ses = session.defaultSession;

    // Auto-approve WebRTC media permissions (camera, microphone, screen capture, notifications)
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = [
            'media',
            'notifications',
            'display-capture',
            'pointerLock',
            'fullscreen',
            'clipboard-read',
            'clipboard-sanitized-write'
        ];
        callback(allowedPermissions.includes(permission));
    });

    ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
        return true;
    });

    // Handle screen sharing requests
    ses.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
            if (sources.length > 0) {
                callback({ video: sources[0] });
            } else {
                callback({});
            }
        }).catch((err) => {
            console.error('Error in desktopCapturer:', err);
            callback({});
        });
    });

    // CRITICAL: Persist session cookies across restarts
    // By default Chromium purges session cookies (cookies without Expires) on exit.
    // We convert all Yandex session cookies to persistent cookies (1 year validity)
    // and immediately flush them to SQLite on disk.
    ses.cookies.on('changed', (event, cookie, cause, removed) => {
        if (!removed && cookie.session && (cookie.domain.includes('yandex') || cookie.domain.includes('ya.ru'))) {
            const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
            const protocol = cookie.secure ? 'https:' : 'http:';
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
        title: 'Яндекс Телемост',
        icon: path.join(__dirname, 'icon.png'),
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 550,
        backgroundColor: '#161616',
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: true,
            backgroundThrottling: false
        }
    });

    mainWindow.webContents.setUserAgent(USER_AGENT);

    // If meeting URL passed via CLI, open it, else home page
    let startUrl = 'https://telemost.yandex.ru/';
    const args = process.argv.slice(1);
    const meetingArg = args.find(arg => arg.startsWith('telemost:') || arg.includes('telemost.yandex.ru/j/'));
    if (meetingArg) {
        startUrl = meetingArg.replace(/^telemost:\/\//, 'https://').replace(/^telemost:/, 'https:');
    }

    mainWindow.loadURL(startUrl);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Handle navigation: if clicking login (Passport / ID), load directly in main window!
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.includes('passport.yandex.') || url.includes('id.yandex.')) {
            mainWindow.loadURL(url);
            return { action: 'deny' };
        }
        if (url.includes('telemost.yandex.') || url.includes('360.yandex.')) {
            mainWindow.loadURL(url);
            return { action: 'deny' };
        }
        if (url.includes('yandex.ru') || url.includes('yandex.net') || url.includes('ya.ru') || url.includes('yandex.com')) {
            return { action: 'allow' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
    });

    const flushSession = async () => {
        try {
            await ses.cookies.flushStore();
            await ses.flushStorageData();
        } catch (e) {}
    };

    mainWindow.on('close', async () => {
        await flushSession();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient('telemost', process.execPath, [path.resolve(process.argv[1])]);
        }
    } else {
        app.setAsDefaultProtocolClient('telemost');
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('before-quit', async () => {
    try {
        await session.defaultSession.cookies.flushStore();
        await session.defaultSession.flushStorageData();
    } catch (e) {}
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
