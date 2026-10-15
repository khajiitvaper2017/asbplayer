---
sidebar_position: 3
---

import ImageIcon from '@site/src/components/ImageIcon';

# Mining in depth {#mining-in-depth}

Jiten mining can be started from the subtitle list, the video overlay, the mobile player, or the mining keyboard shortcut.

## Mining dialog {#mining-dialog}

The dialog lets you review the sentence, source, and captured media before sending them to Jiten.

Use the checkboxes under **Words to mine** to choose words, then click **Mine new words to Jiten**. If **Prevent mining multiple words from same subtitle** is on, radio buttons let you choose one word instead.

**Attachment target** is the last word you mined with Jiten Reader. **Attach to Jiten** adds the sentence and media to that word. The target is hidden when its word isn't in the sentence. To show it anyway and select text with the highlight button, enable **Show attachment target even when sentence doesn't match**. Both of these settings are off by default.

The selected time range controls the sentence and media capture. For local video, use the image preview button <ImageIcon /> to choose a different screenshot timestamp. Audio can be previewed or re-recorded when supported by the video source.

## Jiten workflows {#jiten-workflows}

- **Show mining dialog**: capture the current subtitle and review it before sending.
- **Update last card**: attach the current sentence and enabled media to the last word mined with Jiten Reader. Existing pictures and audio are kept.
- **Mine new words to Jiten**: find new words from the Reader-parsed subtitle and send them to the selected Jiten deck.
- **None**: keep the subtitle in mining history without sending it.

For automatic context attachment when mining in Jiten Reader, see [Mining to Jiten](./jiten#attach-context).
