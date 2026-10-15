---
sidebar_position: 1
---

# Settings {#settings}

## Jiten {#jiten}

Choose how to save words and attach sentences, pictures, and audio. See [Mining to Jiten](../guides/jiten) for setup and a screenshot of these settings.

### Jiten API key {#jiten-api-key}

Connects asbplayer to your Jiten account. Copy the key from [Jiten settings](https://jiten.moe/settings#:~:text=API%20Key).

### Mining deck {#jiten-mining-deck}

Words saved with **Mine new words** go into this deck. The link below the selector opens your Jiten account settings to create a deck.

### Prevent mining multiple words from same subtitle {#jiten-prevent-multiple-words}

Off by default. Turn it on to choose only one word at a time. The mining dialog uses radio buttons instead of checkboxes. If a one-click mining action finds several words, it opens the dialog so you can choose.

With this off, the dialog lets you select several words using checkboxes. Only selected words are mined.

### Show attachment target even when sentence doesn't match {#jiten-show-unmatched-attachment-target}

Off by default. The attachment target is the last word mined with Jiten Reader. It is hidden when its word isn't in the current sentence.

Turn this on to show it anyway and enable the sentence highlight button. Select text, then click the button to use that text for the attachment. With this off, the sentence appears as plain text without a highlight button.

### Automatically attach sentence and media when mining with Jiten Reader {#jiten-auto-attach}

On by default. Mining a word in Jiten Reader automatically adds the matching subtitle sentence and any pictures or audio you have enabled. Turn this off if you want to review them in the mining dialog first.

### Jiten+ tier and media storage {#jiten-tier-and-storage}

Shows your account's tier and how much media storage you have used. The picture and audio switches appear below this information.

Media uploads require Jiten+ or an eligible trial.

### Attach screenshot / video {#jiten-attach-visual}

Send the captured visual to Jiten when the target word has no visual attachment.

### Attach audio {#jiten-attach-audio}

Send captured audio to Jiten when the target word has no audio attachment.

## Mining {#mining}

### Mining destination {#mining-destination}

This fork uses **Jiten** as its mining destination.

### Mining button default action {#mining-button-default-action}

Choose what happens when you click the mining button in the subtitle list or video overlay.

![Mining settings showing the four mining button actions](/img/mining-button-actions.jpg)

| Action | Behavior |
| --- | --- |
| Show mining dialog | Capture the subtitle and review it before sending to Jiten. |
| Attach media | Attach the current sentence and enabled media to the last word mined with Jiten Reader. |
| Mine new words | Send qualifying new Reader words to the selected Jiten deck. |
| None | Record the subtitle in mining history without sending it. |

For **Attach media**, mine a word with Jiten Reader first. This action adds context to that word; it doesn't mine new words into your deck. Existing pictures and audio are kept. If the sentence needs attention, the mining dialog opens so you can review it.

### Post-mining playback state {#post-mining-playback-state}

Choose whether playback should resume, pause, or use the previous state after mining.

### Copy mined subtitles to clipboard {#copy-mined-subtitles-to-clipboard}

Copy the mined subtitle text to the clipboard.

### Audio and image capture {#audio-and-image-capture}

Configure audio padding, audio format, screenshot format, capture dimensions, black-bar trimming, clip trimming, and capture delay.

### Surrounding subtitles {#surrounding-subtitles}

Control how many surrounding subtitles and how much surrounding time are included in captured context.

## Subtitles {#subtitle-appearance}

Configure subtitle tracks, text styling, colors, and layout. Related color and size fields share a row when there is room.

The **Subtitle list** section controls timestamps, mining-button visibility, preview thumbnails, and subtitle placement above thumbnails. **Behavior** controls the remembered timing offset, automatic clipboard copying, and tracks eligible for copying. **Text processing** contains the regex filter and replacement, HTML handling, and ruby detection.

## Playback {#playback}

Configure playback speed, speed notifications, and remembered playback rate and modes. **Auto-pause** controls pausing on hover or subtitle boundaries, automatic resume, pause durations, and subtitle visibility during playback modes.

**Repeat** controls the repeat count. **Skipping** controls fast-forward speed, minimum skipping intervals, and condensed playback. Open **Advanced timing** to adjust subtitle or gap trigger offsets. Tracks eligible for seeking are also configured here.

Timing fields share rows on wider screens. Radio options use a single row when they fit and switch directly to a vertical list otherwise.

## Keyboard shortcuts {#keyboard-shortcuts}

Keyboard shortcuts are grouped into subtitles, mining, playback, seeking, playback rate, and subtitle offset. The extension may also expose browser-level shortcuts in its shortcut settings.

### Mining shortcuts {#mining-keyboard-shortcuts}

Mining shortcuts open the Jiten mining dialog or trigger the configured mining button action.

### Subtitle offset shortcuts {#subtitle-offset-keyboard-shortcuts}

Use these shortcuts to move subtitle timing forward or backward while watching.

## Streaming video {#streaming-video}

Extension-only settings control the controls overlay, subtitle detection, subtitle display, audio recording, screenshots, cropping, and subtitle file handling.

## General {#misc}

Configure theme, language, auto-maximizing local video, and the app tab name. Expand **WebSocket interface** for connection settings and connection checks. **Tools** provides settings import/export and logs.

The mining history storage limit is in **Mining → History**.

## Profiles {#profiles}

A profile is a separate set of settings. The active profile can be changed from the settings UI or while loading subtitles.
