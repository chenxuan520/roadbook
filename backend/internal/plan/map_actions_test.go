package plan

import (
	"encoding/json"
	"testing"
	"time"
)

func TestApplyMapActionsAddsAndEditsItinerary(t *testing.T) {
	now := time.Date(2026, 8, 3, 4, 30, 0, 0, time.UTC)
	content := json.RawMessage(`{"version":"test","markers":[],"connections":[],"labels":[],"dateNotes":{}}`)
	actions := []json.RawMessage{
		json.RawMessage(`{"action":"add_marker","id":101,"title":"Start","lat":39.9,"lng":116.4,"dateTime":"2026-10-01 09:00:00"}`),
		json.RawMessage(`{"action":"add_marker","id":102,"title":"Museum","lat":39.91,"lng":116.41,"dateTime":["2026-10-01 11:00:00","2026-10-02"]}`),
		json.RawMessage(`{"action":"connect_markers","id":201,"start_id":101,"end_id":102,"transport":"walk","dateTime":"2026-10-01 10:00:00"}`),
		json.RawMessage(`{"action":"update_marker","id":102,"title":"Updated Museum","lat":39.92,"lng":116.42}`),
		json.RawMessage(`{"action":"update_connection","id":201,"transport":"car","dateTime":"2026-10-01 10:30:00"}`),
		json.RawMessage(`{"action":"update_date_note","date":"2026-10-01","note":"Morning city route."}`),
	}

	updated, results, err := ApplyMapActions(content, actions, now)
	if err != nil {
		t.Fatalf("ApplyMapActions returned error: %v", err)
	}
	if len(results) != len(actions) {
		t.Fatalf("got %d results, want %d", len(results), len(actions))
	}

	var root map[string]interface{}
	if err := json.Unmarshal(updated, &root); err != nil {
		t.Fatalf("updated content is not JSON: %v", err)
	}

	markers := root["markers"].([]interface{})
	if len(markers) != 2 {
		t.Fatalf("got %d markers, want 2", len(markers))
	}
	second := markers[1].(map[string]interface{})
	if second["title"] != "Updated Museum" {
		t.Fatalf("marker title = %v, want Updated Museum", second["title"])
	}
	position := second["position"].([]interface{})
	if position[0].(float64) != 39.92 || position[1].(float64) != 116.42 {
		t.Fatalf("marker position = %#v", position)
	}

	connections := root["connections"].([]interface{})
	if len(connections) != 1 {
		t.Fatalf("got %d connections, want 1", len(connections))
	}
	connection := connections[0].(map[string]interface{})
	if connection["transportType"] != "car" {
		t.Fatalf("connection transport = %v, want car", connection["transportType"])
	}
	if connection["startId"].(float64) != 101 || connection["endId"].(float64) != 102 {
		t.Fatalf("connection ids = %v -> %v, want numeric marker ids 101 -> 102", connection["startId"], connection["endId"])
	}
	if connection["endTitle"] != "Updated Museum" {
		t.Fatalf("connection endTitle = %v, want Updated Museum", connection["endTitle"])
	}

	dateNotes := root["dateNotes"].(map[string]interface{})
	note := dateNotes["2026-10-01"].(map[string]interface{})
	if note["notes"] != "Morning city route." {
		t.Fatalf("date note = %v", note["notes"])
	}
}

func TestApplyMapActionsRejectsInvalidActionWithoutPartialUpdate(t *testing.T) {
	now := time.Date(2026, 8, 3, 4, 30, 0, 0, time.UTC)
	content := json.RawMessage(`{"markers":[],"connections":[],"labels":[],"dateNotes":{}}`)
	actions := []json.RawMessage{
		json.RawMessage(`{"action":"add_marker","id":101,"title":"Start","lat":39.9,"lng":116.4,"dateTime":"2026-10-01 09:00:00"}`),
		json.RawMessage(`{"action":"connect_markers","start_id":101,"end_id":999,"transport":"walk"}`),
	}

	updated, results, err := ApplyMapActions(content, actions, now)
	if err == nil {
		t.Fatal("ApplyMapActions succeeded, want error")
	}
	if updated != nil {
		t.Fatalf("updated content = %s, want nil", string(updated))
	}
	if results != nil {
		t.Fatalf("results = %#v, want nil", results)
	}

	actionErr, ok := err.(*MapActionError)
	if !ok {
		t.Fatalf("error type = %T, want *MapActionError", err)
	}
	if actionErr.Index != 1 || actionErr.Action != "connect_markers" {
		t.Fatalf("action error = index %d action %q", actionErr.Index, actionErr.Action)
	}
}

func TestApplyMapActionsRemoveMarkerDeletesConnections(t *testing.T) {
	now := time.Date(2026, 8, 3, 4, 30, 0, 0, time.UTC)
	content := json.RawMessage(`{
		"markers":[
			{"id":101,"position":[39.9,116.4],"title":"Start","dateTimes":["2026-10-01 09:00:00"],"dateTime":"2026-10-01 09:00:00"},
			{"id":102,"position":[39.91,116.41],"title":"Museum","dateTimes":["2026-10-01 11:00:00"],"dateTime":"2026-10-01 11:00:00"}
		],
		"connections":[
			{"id":201,"startId":101,"endId":102,"transportType":"walk","dateTime":"2026-10-01 10:00:00"}
		],
		"labels":[],
		"dateNotes":{}
	}`)
	actions := []json.RawMessage{
		json.RawMessage(`{"action":"remove_marker","id":101}`),
	}

	updated, results, err := ApplyMapActions(content, actions, now)
	if err != nil {
		t.Fatalf("ApplyMapActions returned error: %v", err)
	}
	if len(results) != 1 || len(results[0].RemovedConnectionIDs) != 1 {
		t.Fatalf("removed connection results = %#v", results)
	}

	var root map[string]interface{}
	if err := json.Unmarshal(updated, &root); err != nil {
		t.Fatalf("updated content is not JSON: %v", err)
	}
	if got := len(root["markers"].([]interface{})); got != 1 {
		t.Fatalf("got %d markers, want 1", got)
	}
	if got := len(root["connections"].([]interface{})); got != 0 {
		t.Fatalf("got %d connections, want 0", got)
	}
}

func TestApplyMapActionsConnectMarkersPreservesMarkerIDTypes(t *testing.T) {
	now := time.Date(2026, 8, 3, 4, 30, 0, 0, time.UTC)
	content := json.RawMessage(`{
		"markers":[
			{"id":101,"position":[39.9,116.4],"title":"Start","dateTimes":["2026-10-01 09:00:00"],"dateTime":"2026-10-01 09:00:00"},
			{"id":102,"position":[39.91,116.41],"title":"Museum","dateTimes":["2026-10-01 11:00:00"],"dateTime":"2026-10-01 11:00:00"}
		],
		"connections":[],
		"labels":[],
		"dateNotes":{}
	}`)
	actions := []json.RawMessage{
		json.RawMessage(`{"action":"connect_markers","id":201,"start_id":"101","end_id":"102","transport":"walk"}`),
	}

	updated, _, err := ApplyMapActions(content, actions, now)
	if err != nil {
		t.Fatalf("ApplyMapActions returned error: %v", err)
	}

	var root map[string]interface{}
	if err := json.Unmarshal(updated, &root); err != nil {
		t.Fatalf("updated content is not JSON: %v", err)
	}
	connection := root["connections"].([]interface{})[0].(map[string]interface{})
	if connection["startId"].(float64) != 101 || connection["endId"].(float64) != 102 {
		t.Fatalf("connection ids = %v -> %v, want numeric marker ids 101 -> 102", connection["startId"], connection["endId"])
	}
}

func TestFileRepositoryApplyMapActionsMergesSequentialActions(t *testing.T) {
	repo, cleanup := setupTestEnv(t)
	defer cleanup()

	p := &Plan{
		Name:    "map action repo test",
		Content: json.RawMessage(`{"markers":[],"connections":[],"labels":[],"dateNotes":{}}`),
	}
	if err := repo.Save(p); err != nil {
		t.Fatalf("Save returned error: %v", err)
	}

	now := time.Date(2026, 8, 3, 4, 30, 0, 0, time.UTC)
	_, _, err := repo.ApplyMapActions(p.ID, []json.RawMessage{
		json.RawMessage(`{"action":"add_marker","id":101,"title":"Start","lat":39.9,"lng":116.4,"dateTime":"2026-10-01 09:00:00"}`),
	}, now)
	if err != nil {
		t.Fatalf("first ApplyMapActions returned error: %v", err)
	}
	updated, _, err := repo.ApplyMapActions(p.ID, []json.RawMessage{
		json.RawMessage(`{"action":"add_marker","id":102,"title":"Museum","lat":39.91,"lng":116.41,"dateTime":"2026-10-01 11:00:00"}`),
	}, now.Add(time.Second))
	if err != nil {
		t.Fatalf("second ApplyMapActions returned error: %v", err)
	}

	var root map[string]interface{}
	if err := json.Unmarshal(updated.Content, &root); err != nil {
		t.Fatalf("updated content is not JSON: %v", err)
	}
	if got := len(root["markers"].([]interface{})); got != 2 {
		t.Fatalf("got %d markers, want 2", got)
	}
}
