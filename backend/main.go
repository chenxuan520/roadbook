package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// =================================================================================
// 一、数据结构定义 (Nominatim 标准输出格式)
// =================================================================================

type NominatimResult struct {
	PlaceID     int64    `json:"place_id"`
	Licence     string   `json:"licence"`
	OsmType     string   `json:"osm_type"`
	OsmID       int64    `json:"osm_id"`
	BoundingBox []string `json:"boundingbox"` // OSM 返回的是字符串数组
	Lat         string   `json:"lat"`         // OSM 返回的是字符串
	Lon         string   `json:"lon"`         // OSM 返回的是字符串
	DisplayName string   `json:"display_name"`
	Class       string   `json:"class"`
	Type        string   `json:"type"`
	Importance  float64  `json:"importance"`
}

// =================================================================================
// 二、数学算法库: 百度椭球体墨卡托 -> GPS (WGS84)
// =================================================================================

const (
	PI      = 3.1415926535897932384626
	R_MAJOR = 6378137.0           // 长半轴
	R_MINOR = 6356752.3142        // 短半轴
	F       = 1.0 / 298.257223563 // 扁率

	// GCJ02 常量
	X_PI = 3.14159265358979324 * 3000.0 / 180.0
	A    = 6378245.0
	EE   = 0.00669342162296594323
)

// 计算第一偏心率 E
var E = math.Sqrt(1 - (R_MINOR/R_MAJOR)*(R_MINOR/R_MAJOR))

// 1. 百度墨卡托(椭球) -> 百度经纬度 (BD-09)
func mercatorToLngLatEllipsoid(x, y float64) (float64, float64) {
	// 经度计算
	lng := (x / R_MAJOR) * (180.0 / PI)

	// 纬度计算 (迭代法)
	ts := math.Exp(-y / R_MAJOR)
	phi := PI/2 - 2*math.Atan(ts)

	dphi := 1.0
	i := 0
	for math.Abs(dphi) > 0.0000001 && i < 15 {
		con := E * math.Sin(phi)
		dphi = PI/2 - 2*math.Atan(ts*math.Pow((1.0-con)/(1.0+con), E/2.0)) - phi
		phi += dphi
		i++
	}
	lat := phi * (180.0 / PI)
	return lng, lat
}

// 2. BD09 -> GCJ02
func bd09ToGcj02(bdLon, bdLat float64) (float64, float64) {
	x := bdLon - 0.0065
	y := bdLat - 0.006
	z := math.Sqrt(x*x+y*y) - 0.00002*math.Sin(y*X_PI)
	theta := math.Atan2(y, x) - 0.000003*math.Cos(x*X_PI)
	return z * math.Cos(theta), z * math.Sin(theta)
}

// 3. GCJ02 -> WGS84
func gcj02ToWgs84(lng, lat float64) (float64, float64) {
	if outOfChina(lng, lat) {
		return lng, lat
	}
	dlat := transformLat(lng-105.0, lat-35.0)
	dlng := transformLng(lng-105.0, lat-35.0)
	radlat := lat / 180.0 * PI
	magic := math.Sin(radlat)
	magic2 := 1 - EE*magic*magic
	sqrtmagic := math.Sqrt(magic2)
	dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic2 * sqrtmagic) * PI)
	dlng = (dlng * 180.0) / (A / sqrtmagic * math.Cos(radlat) * PI)
	mglat := lat + dlat
	mglng := lng + dlng
	return lng*2 - mglng, lat*2 - mglat
}

func transformLat(x, y float64) float64 {
	ret := -100.0 + 2.0*x + 3.0*y + 0.2*y*y + 0.1*x*y + 0.2*math.Sqrt(math.Abs(x))
	ret += (20.0*math.Sin(6.0*x*PI) + 20.0*math.Sin(2.0*x*PI)) * 2.0 / 3.0
	ret += (20.0*math.Sin(y*PI) + 40.0*math.Sin(y/3.0*PI)) * 2.0 / 3.0
	ret += (160.0*math.Sin(y/12.0*PI) + 320*math.Sin(y*PI/30.0)) * 2.0 / 3.0
	return ret
}

func transformLng(x, y float64) float64 {
	ret := 300.0 + x + 2.0*y + 0.1*x*x + 0.1*x*y + 0.1*math.Sqrt(math.Abs(x))
	ret += (20.0*math.Sin(6.0*x*PI) + 20.0*math.Sin(2.0*x*PI)) * 2.0 / 3.0
	ret += (20.0*math.Sin(x*PI) + 40.0*math.Sin(x/3.0*PI)) * 2.0 / 3.0
	ret += (150.0*math.Sin(x/12.0*PI) + 300.0*math.Sin(x/30.0*PI)) * 2.0 / 3.0
	return ret
}

func outOfChina(lng, lat float64) bool {
	return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

// 聚合转换: 百度墨卡托 -> GPS
func convertBaiduToGPS(mx, my float64) (float64, float64) {
	bdLng, bdLat := mercatorToLngLatEllipsoid(mx, my)
	gcjLng, gcjLat := bd09ToGcj02(bdLng, bdLat)
	return gcj02ToWgs84(gcjLng, gcjLat)
}

// 解析百度 Geo 字符串 "1|123,456;..." 提取第一个坐标
func parseBaiduGeo(geo string) (float64, float64, bool) {
	if geo == "" {
		return 0, 0, false
	}
	parts := strings.Split(geo, "|")
	if len(parts) < 2 {
		return 0, 0, false
	}
	coordStr := strings.Split(parts[1], ";")[0]
	xy := strings.Split(coordStr, ",")
	if len(xy) < 2 {
		return 0, 0, false
	}
	mx, err1 := strconv.ParseFloat(xy[0], 64)
	my, err2 := strconv.ParseFloat(xy[1], 64)
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return mx, my, true
}

// =================================================================================
// 三、Handler 实现
// =================================================================================

// 1. 百度地图 Handler
func baiduSearchHandler(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusOK, []NominatimResult{})
		return
	}

	// 构造百度请求
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Upstream error"})
		return
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	// 检查是否被拦截 (返回 HTML)
	if strings.HasPrefix(strings.TrimSpace(string(bodyBytes)), "<") {
		// 返回空数组，不报错
		c.JSON(http.StatusOK, []NominatimResult{})
		return
	}

	// 解析百度 JSON (结构动态，用 map 处理最灵活)
	var baiduResp map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &baiduResp); err != nil {
		c.JSON(http.StatusOK, []NominatimResult{})
		return
	}

	// 提取 content
	var contentList []interface{}
	if content, ok := baiduResp["content"].([]interface{}); ok {
		contentList = content
	} else if currentCity, ok := baiduResp["current_city"]; ok {
		contentList = append(contentList, currentCity)
	}

	results := []NominatimResult{}

	for i, itemInterface := range contentList {
		item, ok := itemInterface.(map[string]interface{})
		if !ok {
			continue
		}

		// 提取坐标
		var mx, my float64
		var valid bool

		// 优先从 geo 提取
		if geo, ok := item["geo"].(string); ok {
			mx, my, valid = parseBaiduGeo(geo)
		}
		// 其次尝试直接读取 x, y
		if !valid {
			if xVal, ok := item["x"].(float64); ok {
				if yVal, ok := item["y"].(float64); ok {
					mx, my = xVal, yVal
					valid = true
				}
			}
		}

		// 校验墨卡托坐标量级 (必须大于 10000)
		if valid && math.Abs(mx) > 10000 {
			gpsLng, gpsLat := convertBaiduToGPS(mx, my)

			// 构造结果
			name, _ := item["name"].(string)
			addr, _ := item["addr"].(string)
			uidStr, _ := item["uid"].(string)

			// 简单的 uid 转 inthash
			var osmID int64 = int64(time.Now().UnixNano()) + int64(i)
			if len(uidStr) > 8 {
				// 尝试解析一部分 uid hash
				// 这里简单处理，保证唯一即可
			}

			res := NominatimResult{
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

	c.JSON(http.StatusOK, results)
}

// 2. 天地图 Handler
func tianmapSearchHandler(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusOK, []NominatimResult{})
		return
	}

	// 构造参数
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Upstream error"})
		return
	}
	defer resp.Body.Close()

	var tianResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&tianResp); err != nil {
		c.JSON(http.StatusOK, []NominatimResult{})
		return
	}

	results := []NominatimResult{}

	// 处理 POIS
	if pois, ok := tianResp["pois"].([]interface{}); ok {
		for i, p := range pois {
			item := p.(map[string]interface{})
			lonlat, _ := item["lonlat"].(string)
			// 天地图通常用空格分隔，但有时是逗号
			parts := strings.Fields(strings.ReplaceAll(lonlat, ",", " "))
			if len(parts) < 2 {
				continue
			}

			lngStr, latStr := parts[0], parts[1]
			// 天地图直接返回 CGCS2000，可直接视为 WGS84

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

			// 计算 boundingbox
			latVal, _ := strconv.ParseFloat(latStr, 64)
			lngVal, _ := strconv.ParseFloat(lngStr, 64)

			res := NominatimResult{
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
		// 处理行政区
		lonlat, _ := area["lonlat"].(string)
		parts := strings.Fields(strings.ReplaceAll(lonlat, ",", " "))
		if len(parts) >= 2 {
			res := NominatimResult{
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

	c.JSON(http.StatusOK, results)
}

// =================================================================================
// 四、配置结构和加载
// =================================================================================

type Config struct {
	Port           int      `json:"port"`
	AllowedOrigins []string `json:"allowed_origins"`
}

func loadConfig() Config {
	config := Config{
		Port:           8080,       // Default port
		AllowedOrigins: []string{}, // Default to empty
	}

	file, err := os.ReadFile("config.json")
	if err != nil {
		fmt.Println("Config file not found, using default port 8080 and no allowed origins")
		return config
	}

	err = json.Unmarshal(file, &config)
	if err != nil {
		fmt.Println("Error parsing config file, using default port 8080 and no allowed origins")
		return Config{Port: 8080, AllowedOrigins: []string{}}
	}

	if config.Port <= 0 || config.Port > 65535 {
		fmt.Println("Invalid port in config, using default port 8080")
		config.Port = 8080
	}

	return config
}

// =================================================================================
// 五、Main
// =================================================================================

func main() {
	config := loadConfig()

	r := gin.Default()

	// 允许 CORS - 使用配置的允许来源
	r.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		// 检查请求来源是否在允许列表中
		for _, allowedOrigin := range config.AllowedOrigins {
			if origin == allowedOrigin {
				c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
				break
			}
		}

		// c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// 路由注册 - 添加 /api 前缀
	r.GET("/api/cnmap/search", baiduSearchHandler)
	r.GET("/api/tianmap/search", tianmapSearchHandler)

	portStr := fmt.Sprintf(":%d", config.Port)
	fmt.Printf("Server running on %s\n", portStr)
	fmt.Printf("Try Baidu: http://localhost:%d/api/cnmap/search?q=清华大学\n", config.Port)
	fmt.Printf("Try Tian:  http://localhost:%d/api/tianmap/search?q=清华大学\n", config.Port)

	r.Run(portStr)
}
