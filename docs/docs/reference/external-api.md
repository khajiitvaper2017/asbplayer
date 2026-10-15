---
sidebar_position: 2
---

# External API {#external-api}

asbplayer-jiten exposes a WebSocket interface through the bundled local server. The API controls subtitles and playback; Jiten mining is configured in asbplayer-jiten and is not an AnkiConnect proxy.

## WebSocket commands {#websocket-commands}

### `mine-subtitle` {#mine-subtitle}

Mines the active media's current subtitle using the configured Jiten action.

```javascript
{
  "command": "mine-subtitle",
  "messageId": "10281760-d787-4356-8572-f698d8ff3884",
  "body": {
    "postMineAction": 1,
    "mediaId": "a1b2c3d4e5f6"
  }
}
```

`postMineAction` values used by this fork are:

- `0`: keep the subtitle in mining history only
- `1`: open the Jiten mining dialog
- `2`: attach media to the selected Jiten word
- `5`: mine new words to Jiten

The response contains the original `messageId` and a `published` boolean.

### `load-subtitles` {#load-subtitles}

Loads base64-encoded subtitle files into the active media.

```javascript
{
  "command": "load-subtitles",
  "messageId": "3565510c-342f-4cec-ad2e-dee81af88d75",
  "body": {
    "files": [{ "name": "subtitles.srt", "base64": "Zm9vYmFyY..." }]
  }
}
```

### `seek-timestamp` {#seek-timestamp}

Seeks the active media, or the media identified by `mediaId`.

```javascript
{
  "command": "seek-timestamp",
  "messageId": "6e4b2d8f-3a1c-4d9e-8f7b-2c0a9d5e1f3b",
  "body": { "timestamp": 30.5, "mediaId": "a1b2c3d4e5f6" }
}
```

### `get-bound-media` {#get-bound-media}

Returns the media currently tracked by asbplayer-jiten, including its type, title, and loaded subtitle tracks.

### `get-subtitles` {#get-subtitles}

Returns loaded subtitles. Pass `mediaId` and optional `trackNumbers` to select a specific media and tracks.

## HTTP-based API {#http-based-api}

The local server also provides HTTP equivalents:

- `POST asbplayer/load-subtitles`
- `POST asbplayer/seek`
- `GET asbplayer/bound-media`
- `GET asbplayer/subtitles`

See the [WebSocket server guide](../guides/web-socket-server) for setup.
