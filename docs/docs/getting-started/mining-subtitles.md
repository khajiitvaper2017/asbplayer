---
sidebar_position: 2
---

import NoteAddIcon from '@site/src/components/NoteAddIcon';

# Mining subtitles {#mining-subtitles}

asbplayer's mining path is built around [Jiten](https://jiten.moe/). It combines a subtitle sentence with optional audio and images, then sends the result to Jiten.

## Configure Jiten {#configure-jiten}

1. Open [asbplayer's settings](https://asbplayer-jiten.pages.dev/asbplayer/?view=settings).
2. Set **Mining → Mining destination** to **Jiten**.
3. Open the **Jiten** settings tab.
4. Paste the API key from [Jiten settings](https://jiten.moe/settings#:~:text=API%20Key).
5. Choose a mining deck for new words. The link below the selector lets you create one.
6. Choose whether to attach pictures and audio using the switches below the tier information. Media uploads require Jiten+ or an eligible trial.

See the [Jiten mining guide](../guides/jiten) for the complete workflow.

## Mine a subtitle {#mine-subtitles}

1. [Load subtitles](loading-subtitles) onto a video.
2. Click the **Mine Subtitle** <NoteAddIcon /> button.
3. Review the sentence and captured media. Use the checkboxes under **Words to mine** to choose words, then click **Mine new words to Jiten**.
4. To save only one word per subtitle, enable **Prevent mining multiple words from same subtitle** in Jiten settings. The checkboxes become radio buttons.

For one-click mining, set **Mining → Mining button default action** to **Mine new words to Jiten**. With the one-word setting enabled, several available words will open the dialog so you can choose.
