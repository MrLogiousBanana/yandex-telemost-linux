#!/usr/bin/env bash
cd /opt/yandex-telemost || exit 1
exec /opt/yandex-telemost/yandex-telemost /opt/yandex-telemost/resources/app \
    --ozone-platform=x11 \
    --enable-features=WebRTCPipeWireCapturer,TouchpadOverscrollHistoryNavigation \
    --disable-features=Vulkan,OpaqueResourceBlocking \
    "$@"
