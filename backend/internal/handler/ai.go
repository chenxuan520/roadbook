package handler

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/chenxuan520/roadmap/backend/internal/config"
	"github.com/gin-gonic/gin"
)

const (
	AIDataDir     = "data/ai"
	AISessionFile = "session.json"
)

var sessionFileLock sync.RWMutex

type AIChatRequest struct {
	Messages []Message `json:"messages"`
	// SessionID is no longer used for persistence, but kept for compatibility if needed
	SessionID string `json:"session_id,omitempty"`
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

func getSessionFilePath() string {
	return filepath.Join(AIDataDir, AISessionFile)
}

func ensureAIDir() error {
	if _, err := os.Stat(AIDataDir); os.IsNotExist(err) {
		return os.MkdirAll(AIDataDir, 0755)
	}
	return nil
}

func GetAIConfig(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"enabled": cfg.AI.Enabled,
			"model":   cfg.AI.Model,
		})
	}
}

// GetAISession reads the single synchronized session from disk
func GetAISession(c *gin.Context) {
	sessionFileLock.RLock()
	defer sessionFileLock.RUnlock()

	path := getSessionFilePath()
	if _, err := os.Stat(path); os.IsNotExist(err) {
		c.JSON(http.StatusOK, gin.H{"messages": []Message{}})
		return
	}

	data, err := os.ReadFile(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read session file"})
		return
	}

	var messages []Message
	if err := json.Unmarshal(data, &messages); err != nil {
		// If corrupted or empty, return empty list
		c.JSON(http.StatusOK, gin.H{"messages": []Message{}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"messages": messages})
}

// SaveAISession overwrites the single synchronized session on disk
func SaveAISession(c *gin.Context) {
	var req struct {
		Messages []Message `json:"messages"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	sessionFileLock.Lock()
	defer sessionFileLock.Unlock()

	if err := ensureAIDir(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create data directory"})
		return
	}

	path := getSessionFilePath()
	data, err := json.MarshalIndent(req.Messages, "", "  ") // Indent for readability
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to marshal messages"})
		return
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to write session file"})
		return
	}

	c.Status(http.StatusOK)
}

// AIChat is now stateless. It receives context, streams response.
// The client is responsible for saving the history via SaveAISession.
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

		// Stream response back to client
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("Transfer-Encoding", "chunked")

		// Just proxy the stream and record response
		reader := bufio.NewReader(resp.Body)
		var fullResponse strings.Builder

		c.Stream(func(w io.Writer) bool {
			line, err := reader.ReadBytes('\n')
			if err != nil {
				return false
			}
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

		// After stream finishes, save session to disk
		aiMsg := Message{
			Role:    "assistant",
			Content: fullResponse.String(),
		}
		
		// Filter out system messages from history before saving
		// We don't want to save the huge context prompt or temporary system notifications
		var messagesToSave []Message
		for _, msg := range req.Messages {
			if msg.Role != "system" {
				messagesToSave = append(messagesToSave, msg)
			}
		}
		// Append the new assistant response
		messagesToSave = append(messagesToSave, aiMsg)
		
		sessionFileLock.Lock()
		defer sessionFileLock.Unlock()

		if err := ensureAIDir(); err != nil {
			// Log error but don't disrupt the response (too late anyway)
			return
		}

		path := getSessionFilePath()
		data, err := json.MarshalIndent(messagesToSave, "", "  ")
		if err == nil {
			_ = os.WriteFile(path, data, 0644)
		}
	}
}
