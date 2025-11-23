package baidu

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/chenxuan520/roadmap/backend/internal/coord"
	"github.com/chenxuan520/roadmap/backend/internal/domain"
)

func Search(query string) ([]domain.NominatimResult, error) {
	if query == "" {
		return []domain.NominatimResult{}, nil
	}

	baiduURL := "https://map.baidu.com/"
	params := url.Values{}
	params.Set("newmap", "1")
	params.Set("reqflag", "pcmap")
	params.Set("biz", "1")
	params.Set("from", "webmap")
	params.Set("qt", "s")
	params.Set("c", "1")
	params.Set("wd", query)
	params.Set("rn", "10")
	params.Set("ie", "utf-8")

	req, _ := http.NewRequest("GET", baiduURL+"?"+params.Encode(), nil)
	req.Header.Set("Referer", "https://map.baidu.com/")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("upstream error: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	if strings.HasPrefix(strings.TrimSpace(string(bodyBytes)), "<") {
		return []domain.NominatimResult{}, nil
	}

	var baiduResp map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &baiduResp); err != nil {
		return []domain.NominatimResult{}, nil
	}

	var contentList []interface{}
	if content, ok := baiduResp["content"].([]interface{}); ok {
		contentList = content
	} else if currentCity, ok := baiduResp["current_city"]; ok {
		contentList = append(contentList, currentCity)
	}

	results := []domain.NominatimResult{}

	for i, itemInterface := range contentList {
		item, ok := itemInterface.(map[string]interface{})
		if !ok {
			continue
		}

		var mx, my float64
		var valid bool

		if geo, ok := item["geo"].(string); ok {
			mx, my, valid = coord.ParseBaiduGeo(geo)
		}
		if !valid {
			if xVal, ok := item["x"].(float64); ok {
				if yVal, ok := item["y"].(float64); ok {
					mx, my = xVal, yVal
					valid = true
				}
			}
		}

		if valid && math.Abs(mx) > 10000 {
			gpsLng, gpsLat := coord.ConvertBaiduToGPS(mx, my)

			name, _ := item["name"].(string)
			addr, _ := item["addr"].(string)
			uidStr, _ := item["uid"].(string)

			var osmID int64 = int64(time.Now().UnixNano()) + int64(i)
			if len(uidStr) > 8 {
				// simple hash
			}

			res := domain.NominatimResult{
				PlaceID: osmID,
				Licence: "Data © Baidu Map",
				OsmType: "node",
				OsmID:   osmID,
				BoundingBox: []string{
					fmt.Sprintf("%.7f", gpsLat-0.002),
					fmt.Sprintf("%.7f", gpsLat+0.002),
					fmt.Sprintf("%.7f", gpsLng-0.002),
					fmt.Sprintf("%.7f", gpsLng+0.002),
				},
				Lat:         fmt.Sprintf("%.7f", gpsLat),
				Lon:         fmt.Sprintf("%.7f", gpsLng),
				DisplayName: fmt.Sprintf("%s, %s", name, addr),
				Class:       "place",
				Type:        "point",
				Importance:  0.8 - float64(i)*0.05,
			}
			results = append(results, res)
		}
	}

	return results, nil
}
