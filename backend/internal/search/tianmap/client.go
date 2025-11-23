package tianmap

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

func Search(query string) ([]domain.NominatimResult, error) {
	if query == "" {
		return []domain.NominatimResult{}, nil
	}

	tk := "75f0434f240669f4a2df6359275146d2"
	postData := map[string]interface{}{
		"keyWord":       query,
		"level":         "11",
		"mapBound":      "-180,-90,180,90",
		"queryType":     "1",
		"count":         "10",
		"start":         "0",
		"yingjiType":    1,
		"sourceType":    0,
		"queryTerminal": 10000,
	}
	postJson, _ := json.Marshal(postData)

	tianURL := "https://api.tianditu.gov.cn/v2/search"
	u, _ := url.Parse(tianURL)
	q := u.Query()
	q.Set("type", "query")
	q.Set("postStr", string(postJson))
	q.Set("tk", tk)
	u.RawQuery = q.Encode()

	req, _ := http.NewRequest("GET", u.String(), nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://map.tianditu.gov.cn/")
	req.Header.Set("Origin", "https://map.tianditu.gov.cn")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("upstream error: %w", err)
	}
	defer resp.Body.Close()

	var tianResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&tianResp); err != nil {
		return []domain.NominatimResult{}, nil
	}

	results := []domain.NominatimResult{}

	if pois, ok := tianResp["pois"].([]interface{}); ok {
		for i, p := range pois {
			item := p.(map[string]interface{})
			lonlat, _ := item["lonlat"].(string)
			parts := strings.Fields(strings.ReplaceAll(lonlat, ",", " "))
			if len(parts) < 2 {
				continue
			}

			lngStr, latStr := parts[0], parts[1]

			name, _ := item["name"].(string)
			addr, _ := item["address"].(string)
			phone, _ := item["phone"].(string)

			displayName := name
			if addr != "" {
				displayName += ", " + addr
			}
			if phone != "" {
				displayName += " (" + phone + ")"
			}

			latVal, _ := strconv.ParseFloat(latStr, 64)
			lngVal, _ := strconv.ParseFloat(lngStr, 64)

			res := domain.NominatimResult{
				PlaceID: int64(time.Now().UnixNano()) + int64(i),
				Licence: "Data © Tianditu",
				OsmType: "node",
				OsmID:   int64(time.Now().UnixNano()) + int64(i),
				BoundingBox: []string{
					fmt.Sprintf("%.6f", latVal-0.001),
					fmt.Sprintf("%.6f", latVal+0.001),
					fmt.Sprintf("%.6f", lngVal-0.001),
					fmt.Sprintf("%.6f", lngVal+0.001),
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
	} else if area, ok := tianResp["area"].(map[string]interface{}); ok {
		lonlat, _ := area["lonlat"].(string)
		parts := strings.Fields(strings.ReplaceAll(lonlat, ",", " "))
		if len(parts) >= 2 {
			res := domain.NominatimResult{
				PlaceID:     int64(time.Now().UnixNano()),
				Licence:     "Data © Tianditu",
				OsmType:     "relation",
				OsmID:       int64(time.Now().UnixNano()),
				BoundingBox: []string{parts[1], parts[1], parts[0], parts[0]},
				Lat:         parts[1],
				Lon:         parts[0],
				DisplayName: area["name"].(string),
				Class:       "boundary",
				Type:        "administrative",
				Importance:  0.9,
			}
			results = append(results, res)
		}
	}

	return results, nil
}
