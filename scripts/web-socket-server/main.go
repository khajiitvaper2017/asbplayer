package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	_ "github.com/joho/godotenv/autoload"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

// gorilla/websocket allows only one concurrent writer per connection, so each client
// serializes its writes (PONG replies and published commands) behind a mutex.
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type (
	wsClient struct {
		conn     *websocket.Conn
		writeMux sync.Mutex
	}
	forwarder struct {
		WebsocketClients map[*wsClient]bool
		Broker           *requestBroker
		Mutex            *sync.Mutex
		RequestTimeout   time.Duration
	}
	subtitleFile struct {
		Name   string `json:"name"`
		Base64 string `json:"base64"`
	}
	asbplayerLoadSubtitlesRequest struct {
		Files []subtitleFile `json:"files"`
	}
	asbplayerSeekRequest struct {
		Timestamp float64 `json:"timestamp"`
		MediaId   string  `json:"mediaId"`
	}
	clientCommand struct {
		Command   string                 `json:"command"`
		MessageId string                 `json:"messageId"`
		Body      map[string]interface{} `json:"body"`
	}
	clientResponse struct {
		Command   string          `json:"command"`
		MessageId string          `json:"messageId"`
		Body      json.RawMessage `json:"body"`
	}
)

func getenv(key string, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func (client *wsClient) send(messageType int, data []byte) error {
	client.writeMux.Lock()
	defer client.writeMux.Unlock()
	return client.conn.WriteMessage(messageType, data)
}

func (forwarder forwarder) addClient(client *wsClient) {
	forwarder.Mutex.Lock()
	defer forwarder.Mutex.Unlock()
	forwarder.WebsocketClients[client] = true
	fmt.Printf("Client connected: %s\n", client.conn.RemoteAddr())
}

func (forwarder forwarder) removeClient(client *wsClient) {
	forwarder.Mutex.Lock()
	defer forwarder.Mutex.Unlock()
	delete(forwarder.WebsocketClients, client)
	fmt.Printf("Client disconnected: %s\n", client.conn.RemoteAddr())
}

func (forwarder forwarder) clients() []*wsClient {
	forwarder.Mutex.Lock()
	defer forwarder.Mutex.Unlock()
	clients := make([]*wsClient, 0, len(forwarder.WebsocketClients))

	for client := range forwarder.WebsocketClients {
		clients = append(clients, client)
	}

	return clients
}

func (forwarder forwarder) handleWebsocketClient(c echo.Context) error {
	conn, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		c.Logger().Error(err)
		return err
	}

	client := &wsClient{conn: conn}
	defer conn.Close()
	defer forwarder.removeClient(client)
	forwarder.addClient(client)

	for {
		_, msg, err := conn.ReadMessage()

		if err != nil {
			c.Logger().Error(err)
			break
		}

		if string(msg) == "PING" {
			client.send(websocket.TextMessage, []byte("PONG"))
		} else {
			response := clientResponse{}
			if err := json.Unmarshal(msg, &response); err == nil {
				forwarder.Broker.deliver(response)
			}
		}
	}

	return nil
}

func (forwarder forwarder) publishMessage(command clientCommand) error {
	bytes, err := json.Marshal(command)

	if err != nil {
		return err
	}

	for _, client := range forwarder.clients() {
		client.send(websocket.TextMessage, bytes)
	}

	return nil
}

func (forwarder forwarder) publishMessageAndAwaitResponse(command clientCommand) (clientResponse, bool) {
	if len(forwarder.clients()) == 0 {
		return clientResponse{}, false
	}

	request := forwarder.Broker.register(command.MessageId)

	if err := forwarder.publishMessage(command); err != nil {
		forwarder.Broker.cancel(command.MessageId, request)
		return clientResponse{}, false
	}

	select {
	case response, ok := <-request.result:
		return response, ok
	case <-time.After(forwarder.RequestTimeout):
		forwarder.Broker.cancel(command.MessageId, request)
		// A response may have landed just as the timeout fired.
		response, ok := <-request.result
		return response, ok
	}
}

func (forwarder forwarder) handleAsbplayerLoadSubtitlesRequest(c echo.Context) error {
	buf := new(bytes.Buffer)
	buf.ReadFrom(c.Request().Body)
	request := asbplayerLoadSubtitlesRequest{}
	err := json.Unmarshal(buf.Bytes(), &request)

	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err)
	}

	command := clientCommand{Command: "load-subtitles", MessageId: uuid.NewString(), Body: map[string]interface{}{
		"files": request.Files,
	}}
	_, ok := forwarder.publishMessageAndAwaitResponse(command)
	if !ok {
		return echo.NewHTTPError(http.StatusInternalServerError, nil)
	}

	c.String(http.StatusOK, "")
	return nil
}

func (forwarder forwarder) handleAsbplayerSeekRequest(c echo.Context) error {
	buf := new(bytes.Buffer)
	buf.ReadFrom(c.Request().Body)
	request := asbplayerSeekRequest{}
	err := json.Unmarshal(buf.Bytes(), &request)

	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err)
	}

	body := map[string]interface{}{
		"timestamp": request.Timestamp,
	}

	if request.MediaId != "" {
		body["mediaId"] = request.MediaId
	}

	command := clientCommand{Command: "seek-timestamp", MessageId: uuid.NewString(), Body: body}
	_, ok := forwarder.publishMessageAndAwaitResponse(command)
	if !ok {
		return echo.NewHTTPError(http.StatusInternalServerError, nil)
	}

	c.String(http.StatusOK, "")
	return nil
}

func (forwarder forwarder) handleAsbplayerBoundMediaRequest(c echo.Context) error {
	command := clientCommand{Command: "get-bound-media", MessageId: uuid.NewString(), Body: map[string]interface{}{}}
	response, ok := forwarder.publishMessageAndAwaitResponse(command)
	if !ok {
		return echo.NewHTTPError(http.StatusInternalServerError, nil)
	}

	return c.JSONBlob(http.StatusOK, response.Body)
}

func (forwarder forwarder) handleAsbplayerSubtitlesRequest(c echo.Context) error {
	body := map[string]interface{}{}
	if mediaId := c.QueryParam("mediaId"); mediaId != "" {
		body["mediaId"] = mediaId
	}
	if trackNumbers := c.QueryParam("trackNumbers"); trackNumbers != "" {
		parsed := []int{}
		for _, trackNumber := range strings.Split(trackNumbers, ",") {
			if n, err := strconv.Atoi(strings.TrimSpace(trackNumber)); err == nil {
				parsed = append(parsed, n)
			}
		}
		if len(parsed) > 0 {
			body["trackNumbers"] = parsed
		}
	}
	command := clientCommand{Command: "get-subtitles", MessageId: uuid.NewString(), Body: body}
	response, ok := forwarder.publishMessageAndAwaitResponse(command)
	if !ok {
		return echo.NewHTTPError(http.StatusInternalServerError, nil)
	}

	return c.JSONBlob(http.StatusOK, response.Body)
}

func (forwarder forwarder) registerRoutes(e *echo.Echo) {
	e.GET("/ws", forwarder.handleWebsocketClient)
	e.POST("/disconnect-ws-clients", forwarder.disconnectWebsocketClients)
	e.POST("/asbplayer/load-subtitles", forwarder.handleAsbplayerLoadSubtitlesRequest)
	e.POST("/asbplayer/seek", forwarder.handleAsbplayerSeekRequest)
	e.GET("/asbplayer/bound-media", forwarder.handleAsbplayerBoundMediaRequest)
	e.GET("/asbplayer/subtitles", forwarder.handleAsbplayerSubtitlesRequest)
}

func (forwarder forwarder) disconnectWebsocketClients(c echo.Context) error {
	forwarder.Mutex.Lock()
	defer forwarder.Mutex.Unlock()
	for client := range forwarder.WebsocketClients {
		client.conn.Close()
		delete(forwarder.WebsocketClients, client)
		fmt.Printf("Forcefully disconnected client: %s\n", client.conn.RemoteAddr())
	}
	return nil
}

func main() {
	port := getenv("PORT", "8766")
	fmt.Printf("Started on port %s\n", port)

	e := echo.New()
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogStatus:        true,
		LogMethod:        true,
		LogUserAgent:     true,
		LogContentLength: true,
		LogResponseSize:  true,
		LogURI:           true,
		LogLatency:       true,
		LogRemoteIP:      true,
		LogValuesFunc: func(c echo.Context, v middleware.RequestLoggerValues) error {
			fmt.Printf("REQUEST: status=%v method=%v uri=%v latency=%v\n", v.Status, v.Method, v.URI, v.Latency)
			return nil
		},
	}))
	forwarder := forwarder{
		Mutex:            &sync.Mutex{},
		WebsocketClients: make(map[*wsClient]bool),
		Broker:           newRequestBroker(),
		RequestTimeout:   5 * time.Second}

	forwarder.registerRoutes(e)
	e.Logger.Fatal(e.Start(":" + port))
}
