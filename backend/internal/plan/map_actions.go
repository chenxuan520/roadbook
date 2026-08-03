package plan

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

var allowedTransportTypes = map[string]bool{
	"car":    true,
	"walk":   true,
	"train":  true,
	"plane":  true,
	"subway": true,
	"bus":    true,
	"cruise": true,
}

// MapActionResult records one applied server-side map edit.
type MapActionResult struct {
	Index                int           `json:"index"`
	Action               string        `json:"action"`
	Status               string        `json:"status"`
	ID                   interface{}   `json:"id,omitempty"`
	GeneratedID          interface{}   `json:"generatedId,omitempty"`
	RemovedConnectionIDs []interface{} `json:"removedConnectionIds,omitempty"`
}

// MapActionError reports which action failed while preserving atomicity.
type MapActionError struct {
	Index  int
	Action string
	Msg    string
}

func (e *MapActionError) Error() string {
	if e.Action == "" {
		return fmt.Sprintf("action %d failed: %s", e.Index, e.Msg)
	}
	return fmt.Sprintf("action %d (%s) failed: %s", e.Index, e.Action, e.Msg)
}

// ApplyMapActions applies browser-compatible map edit actions to plan content.
// It returns a new JSON document and leaves the input untouched if any action fails.
func ApplyMapActions(content json.RawMessage, actions []json.RawMessage, now time.Time) (json.RawMessage, []MapActionResult, error) {
	if len(actions) == 0 {
		return nil, nil, &MapActionError{Index: -1, Msg: "actions must not be empty"}
	}

	root, err := decodeMapContent(content)
	if err != nil {
		return nil, nil, err
	}
	ensureMapContentShape(root)

	results := make([]MapActionResult, 0, len(actions))
	for i, rawAction := range actions {
		var action map[string]interface{}
		if err := json.Unmarshal(rawAction, &action); err != nil {
			return nil, nil, &MapActionError{Index: i, Msg: "invalid action JSON"}
		}
		actionName, _ := stringField(action, "action")
		actionName = strings.TrimSpace(actionName)
		if actionName == "" {
			return nil, nil, &MapActionError{Index: i, Msg: "action is required"}
		}

		result, err := applyMapAction(root, action, i, actionName, now)
		if err != nil {
			if actionErr, ok := err.(*MapActionError); ok {
				return nil, nil, actionErr
			}
			return nil, nil, &MapActionError{Index: i, Action: actionName, Msg: err.Error()}
		}
		results = append(results, result)
	}

	root["exportTime"] = now.UTC().Format(time.RFC3339Nano)
	data, err := json.Marshal(root)
	if err != nil {
		return nil, nil, err
	}
	return data, results, nil
}

func decodeMapContent(content json.RawMessage) (map[string]interface{}, error) {
	if len(content) == 0 || string(content) == "null" {
		return map[string]interface{}{}, nil
	}

	var root map[string]interface{}
	if err := json.Unmarshal(content, &root); err != nil {
		return nil, &MapActionError{Index: -1, Msg: "plan content must be a JSON object"}
	}
	if root == nil {
		root = map[string]interface{}{}
	}
	return root, nil
}

func ensureMapContentShape(root map[string]interface{}) {
	if _, ok := root["markers"].([]interface{}); !ok {
		root["markers"] = []interface{}{}
	}
	if _, ok := root["connections"].([]interface{}); !ok {
		root["connections"] = []interface{}{}
	}
	if _, ok := root["labels"].([]interface{}); !ok {
		root["labels"] = []interface{}{}
	}
	if _, ok := root["dateNotes"].(map[string]interface{}); !ok {
		root["dateNotes"] = map[string]interface{}{}
	}
}

func applyMapAction(root map[string]interface{}, action map[string]interface{}, index int, actionName string, now time.Time) (MapActionResult, error) {
	switch actionName {
	case "add_marker":
		return applyAddMarker(root, action, index, actionName, now)
	case "update_marker":
		return applyUpdateMarker(root, action, index, actionName)
	case "remove_marker":
		return applyRemoveMarker(root, action, index, actionName)
	case "connect_markers":
		return applyConnectMarkers(root, action, index, actionName, now)
	case "update_connection":
		return applyUpdateConnection(root, action, index, actionName)
	case "remove_connection":
		return applyRemoveConnection(root, action, index, actionName)
	case "update_date_note":
		return applyUpdateDateNote(root, action, index, actionName)
	case "remove_date_note":
		return applyRemoveDateNote(root, action, index, actionName)
	case "set_map_settings":
		return applySetMapSettings(root, action, index, actionName)
	default:
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "unsupported action"}
	}
}

func applyAddMarker(root map[string]interface{}, action map[string]interface{}, index int, actionName string, now time.Time) (MapActionResult, error) {
	markers, err := objectSlice(root, "markers")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}

	lat, err := requiredNumber(action, "lat")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	lng, err := requiredNumber(action, "lng")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	if !validLatLng(lat, lng) {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "lat/lng out of range"}
	}

	title, _ := stringField(action, "title")
	title = strings.TrimSpace(title)
	if title == "" {
		title = fmt.Sprintf("标记点%d", len(markers)+1)
	}

	markerID, generated := markerIDForAdd(action, markers, now, index)
	dateTimes, err := markerDateTimesForAdd(action, markers, now)
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}

	marker := map[string]interface{}{
		"id":        markerID,
		"position":  []interface{}{lat, lng},
		"title":     title,
		"labels":    arrayFieldOrDefault(action, "labels"),
		"logo":      nullableField(action, "logo"),
		"icon":      iconFieldOrDefault(action),
		"createdAt": now.UTC().Format("2006-01-02 15:04:05"),
		"dateTimes": stringSliceToInterfaces(dateTimes),
		"dateTime":  dateTimes[0],
	}
	markers = append(markers, marker)
	setObjectSlice(root, "markers", markers)

	result := MapActionResult{Index: index, Action: actionName, Status: "applied", ID: markerID}
	if generated {
		result.GeneratedID = markerID
	}
	return result, nil
}

func applyUpdateMarker(root map[string]interface{}, action map[string]interface{}, index int, actionName string) (MapActionResult, error) {
	markers, err := objectSlice(root, "markers")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	idValue, idKey, err := requiredID(action, "id")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	markerIndex := findObjectIndexByID(markers, idKey)
	if markerIndex < 0 {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "marker not found"}
	}

	marker := markers[markerIndex]
	updated := false
	titleChanged := false
	if hasField(action, "title") {
		title, _ := stringField(action, "title")
		title = strings.TrimSpace(title)
		if title == "" {
			return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "title must not be empty"}
		}
		marker["title"] = title
		updated = true
		titleChanged = true
	}

	hasLat := hasField(action, "lat")
	hasLng := hasField(action, "lng")
	if hasLat || hasLng {
		if !hasLat || !hasLng {
			return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "lat and lng must be provided together"}
		}
		lat, err := requiredNumber(action, "lat")
		if err != nil {
			return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
		}
		lng, err := requiredNumber(action, "lng")
		if err != nil {
			return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
		}
		if !validLatLng(lat, lng) {
			return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "lat/lng out of range"}
		}
		marker["position"] = []interface{}{lat, lng}
		updated = true
	}

	if hasField(action, "dateTime") {
		dateTimes, err := normalizeMarkerDateTimes(action["dateTime"])
		if err != nil {
			return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
		}
		marker["dateTimes"] = stringSliceToInterfaces(dateTimes)
		marker["dateTime"] = dateTimes[0]
		updated = true
	}
	for _, optionalField := range []string{"labels", "logo", "icon"} {
		if hasField(action, optionalField) {
			marker[optionalField] = action[optionalField]
			updated = true
		}
	}
	if !updated {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "no marker fields to update"}
	}

	markers[markerIndex] = marker
	setObjectSlice(root, "markers", markers)
	if titleChanged {
		updateConnectionTitlesForMarker(root, idKey, stringValue(marker["title"]))
	}
	return MapActionResult{Index: index, Action: actionName, Status: "applied", ID: idValue}, nil
}

func applyRemoveMarker(root map[string]interface{}, action map[string]interface{}, index int, actionName string) (MapActionResult, error) {
	markers, err := objectSlice(root, "markers")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	idValue, idKey, err := requiredID(action, "id")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	markerIndex := findObjectIndexByID(markers, idKey)
	if markerIndex < 0 {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "marker not found"}
	}

	markers = append(markers[:markerIndex], markers[markerIndex+1:]...)
	setObjectSlice(root, "markers", markers)
	adjustLabelsAfterMarkerRemoval(root, markerIndex)

	connections, err := objectSlice(root, "connections")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	kept := make([]map[string]interface{}, 0, len(connections))
	removedIDs := []interface{}{}
	for _, connection := range connections {
		startKey, _ := normalizeIDValue(connection["startId"])
		endKey, _ := normalizeIDValue(connection["endId"])
		if startKey == idKey || endKey == idKey {
			removedIDs = append(removedIDs, connection["id"])
			continue
		}
		kept = append(kept, connection)
	}
	setObjectSlice(root, "connections", kept)

	return MapActionResult{
		Index:                index,
		Action:               actionName,
		Status:               "applied",
		ID:                   idValue,
		RemovedConnectionIDs: removedIDs,
	}, nil
}

func applyConnectMarkers(root map[string]interface{}, action map[string]interface{}, index int, actionName string, now time.Time) (MapActionResult, error) {
	markers, err := objectSlice(root, "markers")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	_, startKey, err := requiredID(action, "start_id")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	_, endKey, err := requiredID(action, "end_id")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	if startKey == endKey {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "start_id and end_id must be different"}
	}

	startIndex := findObjectIndexByID(markers, startKey)
	endIndex := findObjectIndexByID(markers, endKey)
	if startIndex < 0 || endIndex < 0 {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "start or end marker not found"}
	}

	transport, err := transportFieldOrDefault(action, "transport", "car")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	dateTime := defaultConnectionDateTime(markers[startIndex], now)
	if hasField(action, "dateTime") {
		dateTime, err = normalizeConnectionDateTime(action["dateTime"])
		if err != nil {
			return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
		}
	}

	connections, err := objectSlice(root, "connections")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	for _, connection := range connections {
		existingStart, _ := normalizeIDValue(connection["startId"])
		existingEnd, _ := normalizeIDValue(connection["endId"])
		if existingStart == startKey && existingEnd == endKey {
			return MapActionResult{Index: index, Action: actionName, Status: "skipped", ID: connection["id"]}, nil
		}
	}

	connectionID, generated := connectionIDForAdd(action, connections, now, index)
	duration := numberFieldOrDefault(action, "duration", estimateDuration(markers[startIndex], markers[endIndex], transport))
	connection := map[string]interface{}{
		"id":            connectionID,
		"startId":       markers[startIndex]["id"],
		"endId":         markers[endIndex]["id"],
		"transportType": transport,
		"dateTime":      dateTime,
		"label":         stringFieldOrDefault(action, "label", ""),
		"logo":          nullableField(action, "logo"),
		"duration":      duration,
		"startTitle":    stringValue(markers[startIndex]["title"]),
		"endTitle":      stringValue(markers[endIndex]["title"]),
	}
	connections = append(connections, connection)
	setObjectSlice(root, "connections", connections)

	if hasField(action, "dateTime") {
		ensureMarkerDateTime(markers[startIndex], dateTime)
		ensureMarkerDateTime(markers[endIndex], dateTime)
		setObjectSlice(root, "markers", markers)
	}

	result := MapActionResult{Index: index, Action: actionName, Status: "applied", ID: connectionID}
	if generated {
		result.GeneratedID = connectionID
	}
	return result, nil
}

func applyUpdateConnection(root map[string]interface{}, action map[string]interface{}, index int, actionName string) (MapActionResult, error) {
	connections, err := objectSlice(root, "connections")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	idValue, idKey, err := requiredID(action, "id")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	connectionIndex := findObjectIndexByID(connections, idKey)
	if connectionIndex < 0 {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "connection not found"}
	}

	connection := connections[connectionIndex]
	updated := false
	if hasField(action, "transport") {
		transport, err := transportFieldOrDefault(action, "transport", "")
		if err != nil {
			return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
		}
		if transport != "" {
			connection["transportType"] = transport
			updated = true
		}
	}
	if hasField(action, "dateTime") {
		dateTime, err := normalizeConnectionDateTime(action["dateTime"])
		if err != nil {
			return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
		}
		connection["dateTime"] = dateTime
		updated = true
	}
	for _, optionalField := range []string{"label", "logo", "duration"} {
		if hasField(action, optionalField) {
			connection[optionalField] = action[optionalField]
			updated = true
		}
	}
	if !updated {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "no connection fields to update"}
	}

	connections[connectionIndex] = connection
	setObjectSlice(root, "connections", connections)
	return MapActionResult{Index: index, Action: actionName, Status: "applied", ID: idValue}, nil
}

func applyRemoveConnection(root map[string]interface{}, action map[string]interface{}, index int, actionName string) (MapActionResult, error) {
	connections, err := objectSlice(root, "connections")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	idValue, idKey, err := requiredID(action, "id")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	connectionIndex := findObjectIndexByID(connections, idKey)
	if connectionIndex < 0 {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "connection not found"}
	}
	connections = append(connections[:connectionIndex], connections[connectionIndex+1:]...)
	setObjectSlice(root, "connections", connections)
	return MapActionResult{Index: index, Action: actionName, Status: "applied", ID: idValue}, nil
}

func applyUpdateDateNote(root map[string]interface{}, action map[string]interface{}, index int, actionName string) (MapActionResult, error) {
	date, err := normalizedDateField(action, "date")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	note, _ := stringField(action, "note")
	if strings.TrimSpace(note) == "" {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "note must not be empty"}
	}
	if !dateInItinerary(root, date) {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "date not found in itinerary"}
	}

	dateNotes, _ := root["dateNotes"].(map[string]interface{})
	if dateNotes == nil {
		dateNotes = map[string]interface{}{}
		root["dateNotes"] = dateNotes
	}
	switch entry := dateNotes[date].(type) {
	case map[string]interface{}:
		entry["notes"] = note
	case string:
		dateNotes[date] = map[string]interface{}{"notes": note, "expenses": []interface{}{}}
	default:
		dateNotes[date] = map[string]interface{}{"notes": note, "expenses": []interface{}{}}
	}
	return MapActionResult{Index: index, Action: actionName, Status: "applied", ID: date}, nil
}

func applyRemoveDateNote(root map[string]interface{}, action map[string]interface{}, index int, actionName string) (MapActionResult, error) {
	date, err := normalizedDateField(action, "date")
	if err != nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: err.Error()}
	}
	dateNotes, _ := root["dateNotes"].(map[string]interface{})
	if dateNotes == nil {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "date note not found"}
	}
	if _, ok := dateNotes[date]; !ok {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "date note not found"}
	}
	delete(dateNotes, date)
	return MapActionResult{Index: index, Action: actionName, Status: "applied", ID: date}, nil
}

func applySetMapSettings(root map[string]interface{}, action map[string]interface{}, index int, actionName string) (MapActionResult, error) {
	updated := false
	for _, field := range []string{"currentLayer", "currentSearchMethod", "lastDateRange"} {
		if hasField(action, field) {
			root[field] = action[field]
			updated = true
		}
	}
	if !updated {
		return MapActionResult{}, &MapActionError{Index: index, Action: actionName, Msg: "no map settings to update"}
	}
	return MapActionResult{Index: index, Action: actionName, Status: "applied"}, nil
}

func objectSlice(root map[string]interface{}, key string) ([]map[string]interface{}, error) {
	raw, ok := root[key]
	if !ok || raw == nil {
		return []map[string]interface{}{}, nil
	}
	items, ok := raw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("%s must be an array", key)
	}
	objects := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		object, ok := item.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("%s items must be objects", key)
		}
		objects = append(objects, object)
	}
	return objects, nil
}

func setObjectSlice(root map[string]interface{}, key string, objects []map[string]interface{}) {
	items := make([]interface{}, 0, len(objects))
	for _, object := range objects {
		items = append(items, object)
	}
	root[key] = items
}

func adjustLabelsAfterMarkerRemoval(root map[string]interface{}, removedIndex int) {
	labels, err := objectSlice(root, "labels")
	if err != nil {
		return
	}
	kept := make([]map[string]interface{}, 0, len(labels))
	for _, label := range labels {
		index, ok := numberValue(label["markerIndex"])
		if !ok {
			kept = append(kept, label)
			continue
		}
		indexInt := int(index)
		if float64(indexInt) != index {
			kept = append(kept, label)
			continue
		}
		if indexInt == removedIndex {
			continue
		}
		if indexInt > removedIndex {
			label["markerIndex"] = float64(indexInt - 1)
		}
		kept = append(kept, label)
	}
	setObjectSlice(root, "labels", kept)
}

func hasField(object map[string]interface{}, key string) bool {
	_, ok := object[key]
	return ok
}

func stringField(object map[string]interface{}, key string) (string, bool) {
	value, ok := object[key]
	if !ok || value == nil {
		return "", false
	}
	switch v := value.(type) {
	case string:
		return v, true
	default:
		return fmt.Sprint(v), true
	}
}

func stringFieldOrDefault(object map[string]interface{}, key string, fallback string) string {
	if value, ok := stringField(object, key); ok {
		return value
	}
	return fallback
}

func stringValue(value interface{}) string {
	if value == nil {
		return ""
	}
	if s, ok := value.(string); ok {
		return s
	}
	return fmt.Sprint(value)
}

func requiredNumber(object map[string]interface{}, key string) (float64, error) {
	value, ok := object[key]
	if !ok || value == nil {
		return 0, fmt.Errorf("%s is required", key)
	}
	number, ok := numberValue(value)
	if !ok {
		return 0, fmt.Errorf("%s must be a number", key)
	}
	return number, nil
}

func numberFieldOrDefault(object map[string]interface{}, key string, fallback float64) float64 {
	if value, ok := object[key]; ok {
		if number, ok := numberValue(value); ok {
			return number
		}
	}
	return fallback
}

func numberValue(value interface{}) (float64, bool) {
	switch v := value.(type) {
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return 0, false
		}
		return v, true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case json.Number:
		f, err := v.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}

func validLatLng(lat float64, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

func requiredID(object map[string]interface{}, key string) (interface{}, string, error) {
	value, ok := object[key]
	if !ok || value == nil {
		return nil, "", fmt.Errorf("%s is required", key)
	}
	idKey, ok := normalizeIDValue(value)
	if !ok {
		return nil, "", fmt.Errorf("%s must be a string or number", key)
	}
	return value, idKey, nil
}

func normalizeIDValue(value interface{}) (string, bool) {
	if value == nil {
		return "", false
	}
	switch v := value.(type) {
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return "", false
		}
		return s, true
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return "", false
		}
		if math.Trunc(v) == v {
			return strconv.FormatInt(int64(v), 10), true
		}
		return strconv.FormatFloat(v, 'f', -1, 64), true
	case int:
		return strconv.Itoa(v), true
	case int64:
		return strconv.FormatInt(v, 10), true
	case json.Number:
		return v.String(), true
	default:
		return "", false
	}
}

func findObjectIndexByID(objects []map[string]interface{}, idKey string) int {
	for i, object := range objects {
		existingKey, ok := normalizeIDValue(object["id"])
		if ok && existingKey == idKey {
			return i
		}
	}
	return -1
}

func markerIDForAdd(action map[string]interface{}, markers []map[string]interface{}, now time.Time, index int) (interface{}, bool) {
	if value, ok := action["id"]; ok {
		idKey, valid := normalizeIDValue(value)
		if valid && findObjectIndexByID(markers, idKey) < 0 {
			return value, false
		}
	}
	return uniqueGeneratedID(markers, now, index), true
}

func connectionIDForAdd(action map[string]interface{}, connections []map[string]interface{}, now time.Time, index int) (interface{}, bool) {
	if value, ok := action["id"]; ok {
		idKey, valid := normalizeIDValue(value)
		if valid && findObjectIndexByID(connections, idKey) < 0 {
			return value, false
		}
	}
	return uniqueGeneratedID(connections, now, index), true
}

func uniqueGeneratedID(objects []map[string]interface{}, now time.Time, index int) int64 {
	id := now.UnixNano()/int64(time.Millisecond) + int64(index)
	for {
		idKey := strconv.FormatInt(id, 10)
		if findObjectIndexByID(objects, idKey) < 0 {
			return id
		}
		id++
	}
}

func markerDateTimesForAdd(action map[string]interface{}, markers []map[string]interface{}, now time.Time) ([]string, error) {
	if hasField(action, "dateTime") {
		return normalizeMarkerDateTimes(action["dateTime"])
	}
	if len(markers) > 0 {
		last := markers[len(markers)-1]
		if dateTimes, ok := last["dateTimes"].([]interface{}); ok && len(dateTimes) > 0 {
			if s, ok := dateTimes[0].(string); ok && strings.TrimSpace(s) != "" {
				return []string{s}, nil
			}
		}
		if s, ok := last["dateTime"].(string); ok && strings.TrimSpace(s) != "" {
			return []string{s}, nil
		}
	}
	return []string{now.UTC().Format("2006-01-02") + " 00:00:00"}, nil
}

func normalizeMarkerDateTimes(value interface{}) ([]string, error) {
	values := []interface{}{value}
	if arr, ok := value.([]interface{}); ok {
		if len(arr) == 0 {
			return nil, fmt.Errorf("dateTime must not be empty")
		}
		values = arr
	}
	byDay := map[string]string{}
	for _, raw := range values {
		s, ok := raw.(string)
		if !ok {
			return nil, fmt.Errorf("dateTime must be a string or string array")
		}
		normalized, err := normalizeRoadbookDateTime(s)
		if err != nil {
			return nil, err
		}
		day := normalized[:10]
		if existing, ok := byDay[day]; !ok || normalized < existing {
			byDay[day] = normalized
		}
	}
	dateTimes := make([]string, 0, len(byDay))
	for _, dt := range byDay {
		dateTimes = append(dateTimes, dt)
	}
	sortStrings(dateTimes)
	return dateTimes, nil
}

func normalizeConnectionDateTime(value interface{}) (string, error) {
	s, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("dateTime must be a string")
	}
	return normalizeRoadbookDateTime(s)
}

func normalizeRoadbookDateTime(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", fmt.Errorf("dateTime must not be empty")
	}
	for _, layout := range []string{"2006-01-02", "2006-01-02 15:04:05", "2006-01-02T15:04:05"} {
		t, err := time.Parse(layout, s)
		if err == nil {
			if layout == "2006-01-02" {
				return t.Format("2006-01-02") + " 00:00:00", nil
			}
			return t.Format("2006-01-02 15:04:05"), nil
		}
	}
	return "", fmt.Errorf("dateTime must use YYYY-MM-DD or YYYY-MM-DD HH:MM:SS")
}

func normalizedDateField(action map[string]interface{}, key string) (string, error) {
	raw, ok := stringField(action, key)
	if !ok {
		return "", fmt.Errorf("%s is required", key)
	}
	s := strings.TrimSpace(strings.ReplaceAll(raw, "\u200b", ""))
	for i := 0; i+10 <= len(s); i++ {
		candidate := s[i : i+10]
		if _, err := time.Parse("2006-01-02", candidate); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("%s must contain YYYY-MM-DD", key)
}

func stringSliceToInterfaces(values []string) []interface{} {
	items := make([]interface{}, 0, len(values))
	for _, value := range values {
		items = append(items, value)
	}
	return items
}

func arrayFieldOrDefault(object map[string]interface{}, key string) []interface{} {
	if value, ok := object[key].([]interface{}); ok {
		return value
	}
	return []interface{}{}
}

func nullableField(object map[string]interface{}, key string) interface{} {
	if value, ok := object[key]; ok {
		return value
	}
	return nil
}

func iconFieldOrDefault(object map[string]interface{}) interface{} {
	if value, ok := object["icon"]; ok && value != nil {
		return value
	}
	return map[string]interface{}{"type": "default", "icon": "\U0001F4CD", "color": "#667eea"}
}

func transportFieldOrDefault(object map[string]interface{}, key string, fallback string) (string, error) {
	transport := fallback
	if value, ok := stringField(object, key); ok {
		transport = strings.ToLower(strings.TrimSpace(value))
	}
	if transport == "" {
		return "", nil
	}
	if !allowedTransportTypes[transport] {
		return "", fmt.Errorf("%s is not a supported transport type", key)
	}
	return transport, nil
}

func defaultConnectionDateTime(startMarker map[string]interface{}, now time.Time) string {
	if dateTimes, ok := startMarker["dateTimes"].([]interface{}); ok && len(dateTimes) > 0 {
		if s, ok := dateTimes[0].(string); ok && strings.TrimSpace(s) != "" {
			return s
		}
	}
	if s, ok := startMarker["dateTime"].(string); ok && strings.TrimSpace(s) != "" {
		return s
	}
	return now.UTC().Format("2006-01-02") + " 00:00:00"
}

func ensureMarkerDateTime(marker map[string]interface{}, dateTime string) {
	normalized, err := normalizeRoadbookDateTime(dateTime)
	if err != nil {
		return
	}
	dateTimes := []string{}
	if existing, ok := marker["dateTimes"].([]interface{}); ok {
		for _, item := range existing {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				dateTimes = append(dateTimes, s)
			}
		}
	} else if s, ok := marker["dateTime"].(string); ok && strings.TrimSpace(s) != "" {
		dateTimes = append(dateTimes, s)
	}
	day := normalized[:10]
	for _, existing := range dateTimes {
		if strings.HasPrefix(existing, day) {
			return
		}
	}
	dateTimes = append(dateTimes, normalized)
	sortStrings(dateTimes)
	marker["dateTimes"] = stringSliceToInterfaces(dateTimes)
	marker["dateTime"] = dateTimes[0]
}

func updateConnectionTitlesForMarker(root map[string]interface{}, markerIDKey string, title string) {
	connections, err := objectSlice(root, "connections")
	if err != nil {
		return
	}
	for _, connection := range connections {
		startKey, _ := normalizeIDValue(connection["startId"])
		endKey, _ := normalizeIDValue(connection["endId"])
		if startKey == markerIDKey {
			connection["startTitle"] = title
		}
		if endKey == markerIDKey {
			connection["endTitle"] = title
		}
	}
	setObjectSlice(root, "connections", connections)
}

func dateInItinerary(root map[string]interface{}, date string) bool {
	dateNotes, _ := root["dateNotes"].(map[string]interface{})
	if dateNotes != nil {
		if _, ok := dateNotes[date]; ok {
			return true
		}
	}
	markers, _ := objectSlice(root, "markers")
	for _, marker := range markers {
		if s, ok := marker["dateTime"].(string); ok && strings.HasPrefix(s, date) {
			return true
		}
		if dateTimes, ok := marker["dateTimes"].([]interface{}); ok {
			for _, item := range dateTimes {
				if s, ok := item.(string); ok && strings.HasPrefix(s, date) {
					return true
				}
			}
		}
	}
	connections, _ := objectSlice(root, "connections")
	for _, connection := range connections {
		if s, ok := connection["dateTime"].(string); ok && strings.HasPrefix(s, date) {
			return true
		}
	}
	return false
}

func estimateDuration(startMarker map[string]interface{}, endMarker map[string]interface{}, transport string) float64 {
	startLat, startLng, ok := markerLatLng(startMarker)
	if !ok {
		return 0
	}
	endLat, endLng, ok := markerLatLng(endMarker)
	if !ok {
		return 0
	}
	distance := haversineMeters(startLat, startLng, endLat, endLng)
	speeds := map[string]float64{"walk": 5, "car": 80, "train": 250, "plane": 800}
	coefficients := map[string]float64{"walk": 1.2, "car": 1.4, "train": 1.3, "plane": 1.1}
	speed := speeds[transport]
	if speed == 0 {
		speed = 80
	}
	coefficient := coefficients[transport]
	if coefficient == 0 {
		coefficient = 1.4
	}
	actualDistanceKm := (distance * coefficient) / 1000
	return math.Round(actualDistanceKm / speed)
}

func markerLatLng(marker map[string]interface{}) (float64, float64, bool) {
	position, ok := marker["position"].([]interface{})
	if !ok || len(position) < 2 {
		return 0, 0, false
	}
	lat, okLat := numberValue(position[0])
	lng, okLng := numberValue(position[1])
	return lat, lng, okLat && okLng && validLatLng(lat, lng)
}

func haversineMeters(lat1 float64, lng1 float64, lat2 float64, lng2 float64) float64 {
	const earthRadius = 6371000
	toRad := func(deg float64) float64 { return deg * math.Pi / 180 }
	dLat := toRad(lat2 - lat1)
	dLng := toRad(lng2 - lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthRadius * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func sortStrings(values []string) {
	for i := 1; i < len(values); i++ {
		current := values[i]
		j := i - 1
		for j >= 0 && values[j] > current {
			values[j+1] = values[j]
			j--
		}
		values[j+1] = current
	}
}
