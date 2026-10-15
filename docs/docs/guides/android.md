---
sidebar_position: 7.5
---

# Android {#android}

While the UX is worse, it's possible to use asbplayer-jiten on Android devices.

## Website {#website}

The website can be used as-is. The **Overlay UI** will be displayed instead of the default, desktop-optimized video controls.

### Add to home screen {#add-to-home-screen}

As a progressive web app, the website can be added to the home screen of your Android device. From the browser menu, tap "add to home screen."

## Extension {#extension}

:::warning
**Many features are missing**: the **side panel**, **screenshots**, and the **WebSocket interface**. See the [compatibility](../compatibility#browsers-and-features) section for a table of supported and unsupported features on each browser.
:::

As with the website, the primary way to interact with asbplayer-jiten extension is through the **Overlay UI**. The side panel is missing, so instead **subtitles are loaded by selecting the asbplayer-jiten button from the browser's extension menu.**. Using a (bluetooth) keyboard is not necessary but can be very useful for those who prefer to use the [keyboard shortcuts](../reference/settings.md#keyboard-shortcuts) with the extension.

Below are Android browsers where asbplayer-jiten can be installed.

### Firefox for Android {#firefox-for-android}

Install asbplayer-jiten from the [GitHub releases](https://github.com/khajiitvaper2017/asbplayer/releases). Firefox for Android suffers from the same limitations as Firefox - it's not possible to record audio from DRM-protected streams.

### Edge Canary {#edge-canary}

Edge Canary is another Chromium-based mobile browser that can run extensions. As of this writing, asbplayer-jiten on Edge Canary does not support audio recording.
To install asbplayer-jiten on Edge Canary:

1. Download the asbplayer-jiten `crx` file from the [releases page](https://github.com/asbplayer/asbplayer/releases/latest).
2. If not already, enable developer mode from the Edge Canary settings by going to "about Microsoft Edge" and tapping on the build version string several times.
3. From **Developer Options** tap **Extension install by crx** and select the `crx` file you just downloaded.

### Kiwi Browser (discontinued) {#kiwi-browser-discontinued}

Kiwi Browser is a Chromium-based mobile browser that can run extensions. However, its development has been discontinued.
