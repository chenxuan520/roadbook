package handler

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

// TrafficPosResponse 响应结构
type TrafficPosResponse struct {
	Input          LatLonInput   `json:"input"`
	NearestAirport *NearestPoint `json:"nearest_airport,omitempty"`
	NearestStation *NearestPoint `json:"nearest_station,omitempty"`
}

type LatLonInput struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type NearestPoint struct {
	Code   string  `json:"code,omitempty"`
	Name   string  `json:"name"`
	DistKm float64 `json:"dist_km"`
}

// TrafficPosData 存储机场和站点数据
type TrafficPosData struct {
	Airports map[string][2]float64 `json:"airports"` // IATA: [lat, lon]
	Stations map[string][2]float64 `json:"stations"` // 站名: [lon, lat]
}

var trafficPosData *TrafficPosData

// LoadTrafficPosData 加载机场和高铁站数据
func LoadTrafficPosData(configPath string) error {
	trafficPosData = &TrafficPosData{
		Airports: make(map[string][2]float64),
		Stations: make(map[string][2]float64),
	}

	// 加载机场数据
	airportsPath := filepath.Join(configPath, "airports.json")
	if err := loadJSONFile(airportsPath, &trafficPosData.Airports); err != nil {
		return err
	}

	// 加载高铁站数据
	stationsPath := filepath.Join(configPath, "station_geo.json")
	if err := loadJSONFile(stationsPath, &trafficPosData.Stations); err != nil {
		return err
	}

	return nil
}

// loadJSONFile 加载JSON文件
func loadJSONFile(path string, v interface{}) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}

// GetTrafficPos 获取最近的机场和高铁站
func GetTrafficPos(c *gin.Context) {
	latStr := c.Query("lat")
	lonStr := c.Query("lon")

	if latStr == "" || lonStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "请提供有效的 'lat' 和 'lon' 参数",
		})
		return
	}

	var lat, lon float64
	if _, err := fmt.Sscanf(latStr, "%f", &lat); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "无效的纬度参数",
		})
		return
	}
	if _, err := fmt.Sscanf(lonStr, "%f", &lon); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "无效的经度参数",
		})
		return
	}

	if trafficPosData == nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "数据未初始化",
		})
		return
	}

	response := TrafficPosResponse{
		Input: LatLonInput{Lat: lat, Lon: lon},
	}

	// 查找最近机场
	if nearestAirport := findNearestAirport(lat, lon); nearestAirport != nil {
		response.NearestAirport = nearestAirport
	}

	// 查找最近高铁站
	if nearestStation := findNearestStation(lat, lon); nearestStation != nil {
		response.NearestStation = nearestStation
	}

	c.JSON(http.StatusOK, response)
}

// findNearestAirport 查找最近机场
func findNearestAirport(targetLat, targetLon float64) *NearestPoint {
	if trafficPosData == nil || len(trafficPosData.Airports) == 0 {
		return nil
	}

	var minDist float64 = math.MaxFloat64
	var nearest *NearestPoint

	for iata, coords := range trafficPosData.Airports {
		if len(coords) < 2 {
			continue
		}

		dist := getDistanceFromLatLonInKm(targetLat, targetLon, coords[0], coords[1])
		if dist < minDist {
			minDist = dist
			nearest = &NearestPoint{
				Code:   iata,
				Name:   iata,                       // 使用IATA代码作为名称，因为没有其他信息
				DistKm: math.Round(dist*100) / 100, // 保留2位小数
			}
		}
	}

	return nearest
}

// findNearestStation 查找最近高铁站
func findNearestStation(targetLat, targetLon float64) *NearestPoint {
	if trafficPosData == nil || len(trafficPosData.Stations) == 0 {
		return nil
	}

	var minDist float64 = math.MaxFloat64
	var nearest *NearestPoint

	for name, coords := range trafficPosData.Stations {
		if len(coords) < 2 {
			continue
		}

		// 注意：高铁站数据是[lon, lat]格式
		dist := getDistanceFromLatLonInKm(targetLat, targetLon, coords[1], coords[0])
		if dist < minDist {
			minDist = dist
			nearest = &NearestPoint{
				Name:   name,
				DistKm: math.Round(dist*100) / 100, // 保留2位小数
			}
		}
	}

	return nearest
}

// getDistanceFromLatLonInKm Haversine公式计算距离
func getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371 // 地球半径（千米）

	dLat := deg2rad(lat2 - lat1)
	dLon := deg2rad(lon2 - lon1)

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(deg2rad(lat1))*math.Cos(deg2rad(lat2))*
			math.Sin(dLon/2)*math.Sin(dLon/2)

	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

// deg2rad 角度转弧度
func deg2rad(deg float64) float64 {
	return deg * (math.Pi / 180)
}

