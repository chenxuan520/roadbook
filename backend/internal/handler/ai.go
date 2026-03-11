package handler

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/chenxuan520/roadmap/backend/internal/config"
	"github.com/gin-gonic/gin"
)

// SessionStore stores chat history for users.
// Key: SessionID (or UserID/IP), Value: List of messages
type SessionStore struct {
	sync.RWMutex
	Sessions map[string][]Message
}

var globalSessionStore = &SessionStore{
	Sessions: make(map[string][]Message),
}

// Max history to keep (last N messages)
const MaxHistory = 10 // 5 pairs

type AIChatRequest struct {
	Messages []Message `json:"messages"`
	SessionID string    `json:"session_id"` // Optional: Client can provide a session ID
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type OpenAIRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`
	Stream   bool      `json:"stream"`
}

type OpenAIStreamResponse struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
}

func getSessionID(c *gin.Context) string {
	// Simple session ID based on IP for now, or use a cookie/token if available
	// If the client provides a session_id in the request, we could use that,
	// but here we generate a consistent key for the user.
	// For authorized users, use UserID. For guests, use IP.
	// Since this is a simple implementation, let's use IP.
	return c.ClientIP()
}

// UpdateHistory appends new messages and trims to MaxHistory
func (s *SessionStore) UpdateHistory(sessionID string, newMessages []Message) {
	s.Lock()
	defer s.Unlock()

	// In this design, the frontend sends the *full* context it wants the AI to see.
	// But we also want to *store* the history for recovery.
	// So we can simply overwrite the session with the latest valid chain provided by the client,
	// OR append the new exchange.
	// Given the requirement "frontend fully passes content" but "backend stores for recovery",
	// the most robust way is: Save what the frontend sent (plus the AI reply).
	
	// Truncate if necessary (though frontend might have already done it)
	if len(newMessages) > MaxHistory {
		newMessages = newMessages[len(newMessages)-MaxHistory:]
	}
	s.Sessions[sessionID] = newMessages
}

func (s *SessionStore) AppendMessage(sessionID string, msg Message) {
	s.Lock()
	defer s.Unlock()
	
	hist := s.Sessions[sessionID]
	hist = append(hist, msg)
	if len(hist) > MaxHistory {
		hist = hist[len(hist)-MaxHistory:]
	}
	s.Sessions[sessionID] = hist
}

func GetAIConfig(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"enabled": cfg.AI.Enabled,
			"model":   cfg.AI.Model,
		})
	}
}

func GetAIHistory(c *gin.Context) {
	sessionID := getSessionID(c)
	globalSessionStore.RLock()
	history, exists := globalSessionStore.Sessions[sessionID]
	globalSessionStore.RUnlock()

	if !exists {
		history = []Message{}
	}
	c.JSON(http.StatusOK, gin.H{"messages": history})
}

func ClearAIHistory(c *gin.Context) {
	sessionID := getSessionID(c)
	globalSessionStore.Lock()
	delete(globalSessionStore.Sessions, sessionID)
	globalSessionStore.Unlock()
	c.Status(http.StatusNoContent)
}

func AIChat(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.AI.Enabled {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI service is disabled"})
			return
		}

		var req AIChatRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
			return
		}

		sessionID := getSessionID(c)

		// 1. Update session store with the user's latest input (presuming it includes history)
		// NOTE: User requirement says "Backend stores 5 session items for recovery".
		// But also "Frontend passes content".
		// So we take the incoming messages as the "current truth" for this conversation turn.
		// We save it to the store so next time /history is called, we have it.
		// However, we must wait for the AI response to append THAT to the store too.
		
		// Let's first save the user's input messages to the store.
		globalSessionStore.UpdateHistory(sessionID, req.Messages)

		// Prepare request to OpenAI
		openAIReq := OpenAIRequest{
			Model:    cfg.AI.Model,
			Messages: req.Messages,
			Stream:   true,
		}

		reqBody, err := json.Marshal(openAIReq)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to marshal request"})
			return
		}

		client := &http.Client{}
		url := fmt.Sprintf("%s/chat/completions", cfg.AI.BaseURL)
		proxyReq, err := http.NewRequest("POST", url, bytes.NewBuffer(reqBody))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create request"})
			return
		}

		proxyReq.Header.Set("Content-Type", "application/json")
		proxyReq.Header.Set("Authorization", "Bearer "+cfg.AI.Key)

		resp, err := client.Do(proxyReq)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to connect to AI provider"})
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			bodyBytes, _ := io.ReadAll(resp.Body)
			c.JSON(resp.StatusCode, gin.H{"error": "AI Provider Error", "details": string(bodyBytes)})
			return
		}

		// Stream response back to client AND capture it for history
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("Transfer-Encoding", "chunked")

		// Create a TeeReader-like mechanism? No, we need to parse SSE for history.
		// We will read from resp.Body, write to c.Writer, and accumulate content.
		
		reader := bufio.NewReader(resp.Body)
		var fullResponse strings.Builder

		c.Stream(func(w io.Writer) bool {
			line, err := reader.ReadBytes('\n')
			if err != nil {
				return false
			}

			// Write raw line to client immediately to minimize latency
			w.Write(line)

			// Parse line for history accumulation
			// SSE format: data: {...}
			lineStr := string(line)
			if strings.HasPrefix(lineStr, "data: ") {
				dataContent := strings.TrimSpace(strings.TrimPrefix(lineStr, "data: "))
				if dataContent != "[DONE]" {
					var streamResp OpenAIStreamResponse
					if json.Unmarshal([]byte(dataContent), &streamResp) == nil {
						if len(streamResp.Choices) > 0 {
							fullResponse.WriteString(streamResp.Choices[0].Delta.Content)
						}
					}
				}
			}
			return true
		})

		// After stream finishes, append AI response to history
		aiMsg := Message{
			Role:    "assistant",
			Content: fullResponse.String(),
		}
		globalSessionStore.AppendMessage(sessionID, aiMsg)
	}
}
