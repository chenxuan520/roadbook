package coord

import (
	"math"
	"strconv"
	"strings"
)

const (
	PI      = 3.1415926535897932384626
	R_MAJOR = 6378137.0
	R_MINOR = 6356752.3142
	F       = 1.0 / 298.257223563

	X_PI = 3.14159265358979324 * 3000.0 / 180.0
	A    = 6378245.0
	EE   = 0.00669342162296594323
)

var E = math.Sqrt(1 - (R_MINOR/R_MAJOR)*(R_MINOR/R_MAJOR))

func mercatorToLngLatEllipsoid(x, y float64) (float64, float64) {
	lng := (x / R_MAJOR) * (180.0 / PI)

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

func bd09ToGcj02(bdLon, bdLat float64) (float64, float64) {
	x := bdLon - 0.0065
	y := bdLat - 0.006
	z := math.Sqrt(x*x+y*y) - 0.00002*math.Sin(y*X_PI)
	theta := math.Atan2(y, x) - 0.000003*math.Cos(x*X_PI)
	return z * math.Cos(theta), z * math.Sin(theta)
}

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

func ConvertBaiduToGPS(mx, my float64) (float64, float64) {
	bdLng, bdLat := mercatorToLngLatEllipsoid(mx, my)
	gcjLng, gcjLat := bd09ToGcj02(bdLng, bdLat)
	return gcj02ToWgs84(gcjLng, gcjLat)
}

func ParseBaiduGeo(geo string) (float64, float64, bool) {
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
