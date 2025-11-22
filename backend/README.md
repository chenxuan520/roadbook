# MapSearch Proxy

A map search proxy service that provides unified search capabilities for Chinese map services (Baidu Maps and Tianditu), converting coordinates to standard GPS (WGS84) format.

## Features

- **Baidu Maps Search**: Proxy search functionality for Baidu Maps with coordinate conversion
- **Tianditu Search**: Proxy search functionality for Tianditu (China's official map service)
- **Coordinate Conversion**: Converts coordinates from Chinese coordinate systems (BD-09, GCJ-02) to standard WGS84 GPS coordinates
- **Nominatim Compatible Output**: Returns search results in standard Nominatim format for compatibility with GIS tools
- **CORS Support**: Built-in Cross-Origin Resource Sharing support for web applications

## Coordinate System Conversion

The service handles coordinate system conversions between:
- **Baidu Mercator** → **BD-09** → **GCJ-02** → **WGS84** (GPS)
- **Tianditu CGCS2000** → **WGS84** (GPS)

This addresses the unique coordinate system requirements in China where maps use different reference systems.

## API Endpoints

### Baidu Maps Search
```
GET /cnmap/search?q={query}
```
- Query parameter: `q` - search query
- Returns: Array of search results in Nominatim format

### Tianditu Search
```
GET /tianmap/search?q={query}
```
- Query parameter: `q` - search query
- Returns: Array of search results in Nominatim format

### Example Response
```json
[
  {
    "place_id": 1234567890,
    "licence": "Data © Baidu Map",
    "osm_type": "node",
    "osm_id": 1234567890,
    "boundingbox": ["39.9042114", "39.9042114", "116.4073947", "116.4073947"],
    "lat": "39.9042114",
    "lon": "116.4073947",
    "display_name": "清华大学, 北京市海淀区",
    "class": "place",
    "type": "point",
    "importance": 0.75
  }
]
```

## Installation

1. Ensure you have Go installed
2. Clone the repository
3. Create a config.json file (see Configuration section)
4. Run the application:

```bash
go mod tidy
go run main.go
```

## Configuration

Create a `config.json` file in the project root with the following structure:

```json
{
  "port": 8080
}
```

The `port` field specifies which port the server will listen on. If the config.json file is missing or the port value is invalid, the server will default to port 8080.

## Usage

Start the server:
```bash
go run main.go
```

The server will start on port 8080. You can test the endpoints:

- Baidu search: `http://localhost:8080/cnmap/search?q=清华大学`
- Tianditu search: `http://localhost:8080/tianmap/search?q=清华大学`

## Dependencies

- [Gin](https://github.com/gin-gonic/gin): Web framework
- Standard Go libraries for HTTP, JSON parsing, etc.

## License

This project does not specify a license. Please check with the repository owner for licensing information.

## Note

This service is designed specifically for use with Chinese map services and handles special coordinate system conversions required for accurate location data in China. The service fetches data from external map providers and provides it in a standardized format.