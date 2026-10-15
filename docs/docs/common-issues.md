---
sidebar_position: 5
---

# Common issues {#common-issues}

## Subtitles aren't showing up {#subtitles-arent-showing-up}

Check the subtitle visibility and subtitle-track keyboard shortcuts. For streaming video, reload the page after loading subtitles and confirm the extension has access to the site.

## Local video is black or has no audio {#local-video-playback-issues}

Browsers differ in the video and audio formats they can decode. See the [compatibility guide](./compatibility).

## Jiten mining does not attach context {#jiten-context-not-attached}

Confirm that:

- The Jiten API key is valid.
- The target subtitle is loaded and matches the sentence being mined.
- The selected Jiten account can upload the requested media.

You can disable automatic attachment in the Jiten settings and attach context manually from the mining dialog.

## The attachment target is missing {#jiten-attachment-target-missing}

The target is the last word you mined with Jiten Reader. It is hidden when its word isn't in the current sentence. Mine the word you want in Reader, or enable **Show attachment target even when sentence doesn't match** in Jiten settings. You can then select sentence text and click the highlight button before attaching.

## Pictures or audio are turned off {#jiten-media-disabled}

Turn on **Attach screenshot / video** or **Attach audio** below the tier and storage information in Jiten settings. Media uploads require Jiten+ or an eligible trial.

## Keyboard shortcuts aren't working {#keyboard-shortcuts-arent-working}

Check the [keyboard shortcut settings](https://asbplayer-jiten.pages.dev/asbplayer/?view=settings#keyboard-shortcuts) or the [keyboard shortcuts reference](./reference/settings.md#keyboard-shortcuts). For the extension, also check `chrome://extensions/shortcuts`.

## Streaming video is not detected {#asbplayer-isnt-detecting-streaming-video}

Make sure the extension has access to all sites, then reload the page and load subtitles again.

## Screenshots are cropped incorrectly {#screenshot-cropping-issues}

Use 100% browser zoom. Cropping can be disabled in the extension settings.

## Audio recording repeatedly asks for permission {#repeated-audio-permission-prompts}

Disable extensions that control page audio, such as Volume Master, and grant recording permission to asbplayer-jiten.

## Audio recordings are garbled {#garbled-audio-recordings}

This is usually caused by CPU throttling or insufficient CPU. Connect a laptop to power and disable battery-saving mode while recording.

## The streaming shortcut makes the page unresponsive {#streaming-shortcut-unresponsive}

Disable **Experimental Web Platform features** in `chrome://flags` and try again.
