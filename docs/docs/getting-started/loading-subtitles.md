---
sidebar_position: 1
---

# Loading subtitles {#loading-subtitles}

The first step to using asbplayer is to load subtitles onto a video source.

## Streaming video {#streaming-video}

### Chrome (or other Chromium-based browsers) {#chromium}

1. Install the Chrome extension from the [GitHub releases](https://github.com/khajiitvaper2017/asbplayer/releases).
2. Click 🧩 icon in browser toolbar → asbplayer → **Open Side Panel**
3. Click **Load Subtitles** to load subtitles onto any video on the current page.

To install an unpacked development build, clone the [`jiten-fork` branch](https://github.com/khajiitvaper2017/asbplayer/tree/jiten-fork), run `pnpm install`, then run `pnpm --filter @project/extension run build`. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `extension/.output/chrome-mv3`.

### Firefox {#firefox}

:::warning
asbplayer is missing some features on Firefox. See the [Compatibility](../compatibility#extension) section.  
:::

1. Install the Firefox addon from the [GitHub releases](https://github.com/khajiitvaper2017/asbplayer/releases).
2. Click 🧩 icon in browser toolbar → asbplayer → **Open Side Panel**
3. Click **Load Subtitles** to load subtitles onto any video on the current page.

To install an unpacked development build, clone the [`jiten-fork` branch](https://github.com/khajiitvaper2017/asbplayer/tree/jiten-fork), run `pnpm install`, then run `pnpm --filter @project/extension run build:firefox`. Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select `extension/.output/firefox-mv2/manifest.json`.

### Android {#android}

See the [Android guide](../guides/android).

## Video files {#video-files}

1. Open the [website](https://asbplayer-jiten.pages.dev/asbplayer).
2. Drag-and-drop video and subtitle files into the website.
