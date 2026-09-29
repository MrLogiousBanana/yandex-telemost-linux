# Yandex Telemost Linux Client

Нативный Electron-клиент Яндекс Телемост для Linux (Fedora, Ubuntu, Arch).

## Возможности
- Интеграция с PipeWire и WebRTC для демонстрации экрана в Wayland и X11 (`--enable-features=WebRTCPipeWireCapturer`).
- Автоматическая обработка прав на камеру, микрофон и захват экрана.
- Поддержка глубоких ссылок (`telemost://` и `telemost.yandex.ru/j/...`).
- Нативная навигация свайпами тачпада (`TouchpadOverscrollHistoryNavigation`).
- Уведомления и трей.

## Установка
```bash
npm install
# Запуск через Electron
npm start
```
