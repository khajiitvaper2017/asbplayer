---
sidebar_position: 9
---

# WebSocket server {#websocket-server}

asbplayer can connect to a local WebSocket server that exposes an HTTP interface for subtitle loading, seeking, media discovery, and subtitle retrieval.

## Run the server {#run-the-server}

1. Clone the [asbplayer repo](https://github.com/khajiitvaper2017/asbplayer).
2. Install [Golang](https://go.dev/dl/).
3. Run the server:

   ```
   cd asbplayer/scripts/web-socket-server
   go run .
   ```

## Connect asbplayer to the server {#connect-asbplayer-to-the-server}

Enable the WebSocket client from the [General → WebSocket interface](https://asbplayer-jiten.pages.dev/asbplayer/?view=settings#misc-settings). The default server address and port are usually sufficient.

## Use the server {#use-the-server}

See the [external API reference](../reference/external-api) for the available commands and HTTP endpoints.
