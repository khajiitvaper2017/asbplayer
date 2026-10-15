---
sidebar_position: 9
---

# Mining to Jiten {#mining-to-jiten}

Save words to Jiten with sentences, pictures, and audio from your videos. You don't need Anki.

## Setup {#setup}

1. Install Jiten Reader and [load subtitles](../getting-started/loading-subtitles) in asbplayer.
2. Open the **Jiten** tab in asbplayer settings. Copy your API key from [Jiten settings](https://jiten.moe/settings#:~:text=API%20Key) and paste it into **Jiten API key**.
3. Choose a **Mining deck** for new words. Use the link below the selector to create a deck in Jiten.
4. Use **Attach screenshot / video** and **Attach audio** to choose which media to send. Media uploads require Jiten+ or an eligible trial.

![Jiten settings with API key, mining deck, word selection options, and media switches](/img/jiten-settings.png)

The screenshot shows an example setup. **Prevent mining multiple words from same subtitle** is off by default.

For streaming videos, also turn on **Take screenshot when mining** and **Record audio when mining** under **Streaming video**.

## Choose the mining button's action {#mining-button-action}

Open **Mining → Mining button default action** to choose what the **Mine Subtitle** button does.

![Mining settings with Show mining dialog, Attach media, Mine new words, and None](/img/mining-button-actions.jpg)

- **Show mining dialog**: review the sentence, words, and media before sending.
- **Attach media**: attach the current sentence and enabled media to the last word you mined with Jiten Reader. Mine a word in Reader first. Existing pictures and audio won't be replaced.
- **Mine new words**: save new words from the subtitle to your mining deck. With the one-word setting on, several available words open the dialog so you can choose.
- **None**: keep the subtitle in mining history without sending anything to Jiten.

## Save one word {#attach-context}

Mine a word with Jiten Reader in asbplayer's subtitles. asbplayer automatically adds the sentence, picture, and audio to that word. You don't need to click another mining button.

This is on by default. Existing pictures and audio won't be replaced.

### Review before sending {#attach-manually}

To check or edit the sentence first:

1. In **Jiten** settings, turn off **Automatically attach sentence and media when mining with Jiten Reader**.
2. Mine a word with Jiten Reader.
3. Set **Mining → Mining button default action** to **Show mining dialog**, then click **Mine Subtitle**.
4. Check the word, sentence, picture, and audio. Edit if needed.
5. Check **Attachment target**. This is the last word you mined with Jiten Reader, separate from the **Words to mine** list.
6. Click **Attach media**.

The attachment target is hidden when its word isn't in the sentence. To attach a different part of the sentence to that word, turn on **Show attachment target even when sentence doesn't match** in Jiten settings. Select text in the sentence, then click the highlight button. The selected text is marked with `**` and used when you click **Attach media**.

This setting is off by default. With it off, the sentence is shown as plain text without a highlight button.

## Choose new words from a subtitle {#mine-new-words}

1. Select a **Mining deck** in **Jiten** settings. Use the account settings link there if you need to create one.
2. Let Jiten Reader process the subtitle so you can look up its words.
3. Set the mining button's action to **Show mining dialog**, then click **Mine Subtitle**.
4. In **Words to mine**, use the checkboxes to choose words. All listed words are selected at first; uncheck any you don't want.
5. Click **Mine new words**. Only the selected words are saved.

This saves words that Jiten marks as new and that aren't already in your selected deck.

### Mine one word per subtitle {#one-word-per-subtitle}

Turn on **Prevent mining multiple words from same subtitle** in Jiten settings. The checkboxes become radio buttons, so you can select only one word. If several words are available, choose one before mining.

This setting is off by default.

For one-click mining, set **Mining → Mining button default action** to **Mine new words**. If the one-word setting is on and several words are available, the dialog opens so you can choose.

## Blur words or hide subtitle lines {#reader-styles}

In the web app, open **Settings → Jiten Reader styles**. Enable word blurring or line hiding, then choose the Reader word types to match. Hover over a line to reveal it in the video or subtitle panel.

See [Jiten Reader styles](../reference/settings#jiten-reader-styles) for word-type matching rules.

## If something goes wrong {#limits-and-retries}

- **Text is too long:** shorten the sentence or source to 150 characters or fewer, including any `**` marks around the word.
- **File is too large:** shorten the clip or reduce the picture size. Each file must be 5 MiB or smaller.
- **An upload fails:** follow the message in the dialog and try again. Files already saved won't be replaced.

See [Jiten settings](../reference/settings#jiten) for more options.
