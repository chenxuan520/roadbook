package gaode

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/chenxuan520/roadmap/backend/internal/domain"
)

// GaodePOI defines the structure for a single Point of Interest from Gaode API.
type GaodePOI struct {
	Name     string      `json:"name"`
	Location string      `json:"location"` // "lng,lat"
	Address  interface{} `json:"address"`
	ID       string      `json:"id"`
}

// GaodeResponse defines the structure of the top-level JSON response from Gaode API.
type GaodeResponse struct {
	Status string     `json:"status"`
	Info   string     `json:"info"`
	Count  string     `json:"count"`
	POIs   []GaodePOI `json:"pois"`
}

// Search performs a keyword search using the Gaode Web API.
func Search(query string, apiKey string) ([]domain.NominatimResult, error) {
	if query == "" {
		return []domain.NominatimResult{}, nil
	}
	if apiKey == "" {
		return nil, fmt.Errorf("gaode API key is missing")
	}

	apiURL := "https://restapi.amap.com/v3/place/text"
	u, err := url.Parse(apiURL)
	if err != nil {
		return nil, fmt.Errorf("error parsing gaode api url: %w", err)
	}

	q := u.Query()
	q.Set("keywords", query)
	q.Set("key", apiKey)
	u.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("error creating request: %w", err)
	}
	req.Header.Set("User-Agent", "roadbook-backend/1.0")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gaode api request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gaode api returned non-200 status: %d", resp.StatusCode)
	}

	var gaodeResp GaodeResponse
	if err := json.NewDecoder(resp.Body).Decode(&gaodeResp); err != nil {
		return nil, fmt.Errorf("error decoding gaode response: %w", err)
	}

	if gaodeResp.Status != "1" {
		return nil, fmt.Errorf("gaode api returned error status: %s - %s", gaodeResp.Status, gaodeResp.Info)
	}

	results := []domain.NominatimResult{}
	for _, poi := range gaodeResp.POIs {
		parts := strings.Split(poi.Location, ",")
		if len(parts) != 2 {
			continue // Invalid location format
		}
		lngStr, latStr := parts[0], parts[1]

		latVal, err := strconv.ParseFloat(latStr, 64)
		if err != nil {
			continue
		}
		lngVal, err := strconv.ParseFloat(lngStr, 64)
		if err != nil {
			continue
		}

		addressStr := ""
		if poi.Address != nil {
			if addr, ok := poi.Address.(string); ok {
				addressStr = addr
			} else if addrArr, ok := poi.Address.([]interface{}); ok {
				var parts []string
				for _, partVal := range addrArr {
					if p, ok := partVal.(string); ok {
						parts = append(parts, p)
					}
				}
				addressStr = strings.Join(parts, "")
			}
		}

		displayName := poi.Name
		if addressStr != "" {
			displayName += ", " + addressStr
		}

		// Use a hash of the POI ID for a more stable PlaceID
		placeID, err := strconv.ParseInt(strings.ReplaceAll(poi.ID, "B", ""), 16, 64)
		if err != nil {
			placeID = time.Now().UnixNano() // Fallback
		}


		res := domain.NominatimResult{
			PlaceID: placeID,
			Licence: "Data © AutoNavi",
			OsmType: "node",
			OsmID:   placeID, // Using the same for simplicity
			BoundingBox: []string{
				fmt.Sprintf("%.7f", latVal-0.001),
				fmt.Sprintf("%.7f", latVal+0.001),
				fmt.Sprintf("%.7f", lngVal-0.001),
				fmt.Sprintf("%.7f", lngVal+0.001),
			},
			Lat:         latStr,
			Lon:         lngStr,
			DisplayName: displayName,
			Class:       "place",
			Type:        "poi",
			Importance:  0.8,
		}
		results = append(results, res)
	}

	return results, nil
}
