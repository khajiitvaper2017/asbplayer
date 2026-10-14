---
sidebar_position: 1
---

# Settings {#settings}

## Jiten {#jiten}

Configure the Jiten destination and context attachments here. See [Mining to Jiten](../guides/jiten) for setup and workflows.

### Jiten API key {#jiten-api-key}

Authenticates requests to Jiten. Copy the key from [Jiten settings](https://jiten.moe/settings#:~:text=API%20Key).

### Mining deck {#jiten-mining-deck}

The Jiten word-list deck used by **Mine new words to Jiten**.

### Automatically attach sentence and media when mining with Jiten Reader {#jiten-auto-attach}

When enabled, mining a word in Jiten Reader captures and attaches the matching subtitle sentence and enabled media.

### Attach screenshot / video {#jiten-attach-visual}

Send the captured visual to Jiten when the target word has no visual attachment.

### Attach audio {#jiten-attach-audio}

Send captured audio to Jiten when the target word has no audio attachment.

## Mining {#mining}

### Mining destination {#mining-destination}

This fork uses **Jiten** as its mining destination.

### Mining button default action {#mining-button-default-action}

The mining button appears in the subtitle list and video overlay.

| Action | Behavior |
| --- | --- |
| Show mining dialog | Capture the subtitle and review it before sending to Jiten. |
| Mine new words to Jiten | Send qualifying new Reader words to the selected Jiten deck. |
| None | Record the subtitle in mining history without sending it. |

### Post-mining playback state {#post-mining-playback-state}

Choose whether playback should resume, pause, or use the previous state after mining.

### Copy mined subtitles to clipboard {#copy-mined-subtitles-to-clipboard}

Copy the mined subtitle text to the clipboard.

### Audio and image capture {#audio-and-image-capture}

Configure audio padding, audio format, screenshot format, capture dimensions, black-bar trimming, clip trimming, and capture delay.

### Surrounding subtitles {#surrounding-subtitles}

Control how many surrounding subtitles and how much surrounding time are included in captured context.

## Subtitle appearance {#subtitle-appearance}

Configure subtitle tracks, preview thumbnails, text styling, subtitle layout, and display behavior.

## Keyboard shortcuts {#keyboard-shortcuts}

Keyboard shortcuts are grouped into subtitles, mining, playback, seeking, playback rate, and subtitle offset. The extension may also expose browser-level shortcuts in its shortcut settings.

### Mining shortcuts {#mining-keyboard-shortcuts}

Mining shortcuts open the Jiten mining dialog or trigger the configured mining button action.

### Subtitle offset shortcuts {#subtitle-offset-keyboard-shortcuts}

Use these shortcuts to move subtitle timing forward or backward while watching.

## Streaming video {#streaming-video}

Extension-only settings control the controls overlay, subtitle detection, subtitle display, audio recording, screenshots, cropping, and subtitle file handling.

## Miscellaneous {#misc}

Miscellaneous settings include profiles, theme, language, subtitle filtering, playback modes, WebSocket connectivity, and mining history storage.

## Profiles {#profiles}

A profile is a separate set of settings. The active profile can be changed from the settings UI or while loading subtitles.
