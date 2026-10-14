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
5. Choose a mining deck if you want to use **Mine new words to Jiten**.
6. Enable or disable screenshot and audio attachments as needed.

See the [Jiten mining guide](../guides/jiten) for the complete workflow.

## Mine a subtitle {#mine-subtitles}

1. [Load subtitles](loading-subtitles) onto a video.
2. Click the **Mine Subtitle** <NoteAddIcon /> button.
3. Review the sentence, word, and captured media in the mining dialog.
4. Send the card to Jiten.

For one-click mining, set **Mining → Mining button default action** to **Mine new words to Jiten**.
