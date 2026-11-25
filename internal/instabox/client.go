package instabox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	DefaultBaseURL = "https://api.instabox.sh"
	userAgent      = "instabox-monitor/1.0"
)

// Client talks to a single InstaBox account's REST API using X-API-Key authentication.
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	longClient *http.Client
}

// NewClient constructs a Client for an InstaBox account.
func NewClient(baseURL, apiKey string) *Client {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		base = DefaultBaseURL
	}
	return &Client{
		baseURL: base,
		apiKey:  strings.TrimSpace(apiKey),
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		longClient: &http.Client{
			Timeout: 45 * time.Second,
		},
	}
}

// GetMe calls GET /v1/me.
func (c *Client) GetMe(ctx context.Context) (Me, error) {
	var out Me
	err := c.doJSON(ctx, c.httpClient, http.MethodGet, "/v1/me", nil, nil, &out)
	return out, err
}

// ListOrgs calls GET /v1/orgs.
func (c *Client) ListOrgs(ctx context.Context) ([]Org, error) {
	var out OrgList
	err := c.doJSON(ctx, c.httpClient, http.MethodGet, "/v1/orgs", nil, nil, &out)
	return out.Orgs, err
}

// GetUsage calls GET /v1/usage (optionally scoped to orgID).
func (c *Client) GetUsage(ctx context.Context, orgID string) (Usage, error) {
	path := "/v1/usage"
	if strings.TrimSpace(orgID) != "" {
		path += "?org=" + url.QueryEscape(orgID)
	}
	var out Usage
	err := c.doJSON(ctx, c.httpClient, http.MethodGet, path, nil, nil, &out)
	return out, err
}

// ListMachines calls GET /v1/machines and transparently drains all cursor pages.
func (c *Client) ListMachines(ctx context.Context) ([]Machine, error) {
	var all []Machine
	cursor := ""
	const maxPages = 50

	for page := 0; page < maxPages; page++ {
		q := url.Values{}
		q.Set("limit", "100")
		if cursor != "" {
			q.Set("cursor", cursor)
		}
		var resp MachineList
		if err := c.doJSON(ctx, c.httpClient, http.MethodGet, "/v1/machines?"+q.Encode(), nil, nil, &resp); err != nil {
			return nil, err
		}
		all = append(all, resp.Machines...)
		if resp.NextCursor == nil || *resp.NextCursor == "" {
			break
		}
		cursor = *resp.NextCursor
	}
	return all, nil
}

// GetMachine calls GET /v1/machines/{id}.
func (c *Client) GetMachine(ctx context.Context, id string) (Machine, error) {
	var out Machine
	err := c.doJSON(ctx, c.httpClient, http.MethodGet, "/v1/machines/"+url.PathEscape(id), nil, nil, &out)
	return out, err
}

// GetMachineMetrics calls GET /v1/machines/{id}/metrics?since=<since>.
func (c *Client) GetMachineMetrics(ctx context.Context, id, since string) (MachineMetrics, error) {
	path := "/v1/machines/" + url.PathEscape(id) + "/metrics"
	if strings.TrimSpace(since) != "" {
		path += "?since=" + url.QueryEscape(since)
	}
	var out MachineMetrics
	err := c.doJSON(ctx, c.httpClient, http.MethodGet, path, nil, nil, &out)
	return out, err
}

// GetMachineDisk calls GET /v1/machines/{id}/disk.
func (c *Client) GetMachineDisk(ctx context.Context, id string) (MachineDisk, error) {
	var out MachineDisk
	err := c.doJSON(ctx, c.httpClient, http.MethodGet, "/v1/machines/"+url.PathEscape(id)+"/disk", nil, nil, &out)
	return out, err
}

// GetMachineProcesses calls GET /v1/machines/{id}/processes.
func (c *Client) GetMachineProcesses(ctx context.Context, id string) (ProcessList, error) {
	var out ProcessList
	err := c.doJSON(ctx, c.httpClient, http.MethodGet, "/v1/machines/"+url.PathEscape(id)+"/processes", nil, nil, &out)
	return out, err
}

// GetMachineLogs calls GET /v1/machines/{id}/logs with optional tail and incremental cursor after.
func (c *Client) GetMachineLogs(ctx context.Context, id string, tail int, after int64) (MachineLogs, error) {
	q := url.Values{}
	if tail > 0 {
		q.Set("tail", strconv.Itoa(tail))
	}
	if after > 0 {
		q.Set("after", strconv.FormatInt(after, 10))
	}
	path := "/v1/machines/" + url.PathEscape(id) + "/logs"
	if enc := q.Encode(); enc != "" {
		path += "?" + enc
	}
	var out MachineLogs
	err := c.doJSON(ctx, c.httpClient, http.MethodGet, path, nil, nil, &out)
	return out, err
}

// ListPorts calls GET /v1/ports.
func (c *Client) ListPorts(ctx context.Context) (PublicPortList, error) {
	var out PublicPortList
	err := c.doJSON(ctx, c.httpClient, http.MethodGet, "/v1/ports", nil, nil, &out)
	return out, err
}

// ListMachinePorts calls GET /v1/machines/{id}/ports.
func (c *Client) ListMachinePorts(ctx context.Context, machineID string) (PublicPortList, error) {
	var out PublicPortList
	path := fmt.Sprintf("/v1/machines/%s/ports", url.PathEscape(machineID))
	err := c.doJSON(ctx, c.httpClient, http.MethodGet, path, nil, nil, &out)
	return out, err
}

// PublishPort calls POST /v1/machines/{id}/ports to create or update a published port.
func (c *Client) PublishPort(ctx context.Context, machineID string, req PublishPortRequest) (PublicPort, error) {
	var out PublicPort
	path := fmt.Sprintf("/v1/machines/%s/ports", url.PathEscape(machineID))
	err := c.doJSON(ctx, c.httpClient, http.MethodPost, path, nil, req, &out)
	return out, err
}

// UnpublishPort calls DELETE /v1/machines/{id}/ports/{port}.
func (c *Client) UnpublishPort(ctx context.Context, machineID string, port int) error {
	path := fmt.Sprintf("/v1/machines/%s/ports/%d", url.PathEscape(machineID), port)
	return c.doJSON(ctx, c.httpClient, http.MethodDelete, path, nil, nil, nil)
}

// StartMachine calls POST /v1/machines/{id}/start with a fresh Idempotency-Key.
func (c *Client) StartMachine(ctx context.Context, id string) (Operation, error) {
	return c.lifecycleAction(ctx, id, "start", false)
}

// StopMachine calls POST /v1/machines/{id}/stop (with ?now=true when force is true).
func (c *Client) StopMachine(ctx context.Context, id string, force bool) (Operation, error) {
	return c.lifecycleAction(ctx, id, "stop", force)
}

// SuspendMachine calls POST /v1/machines/{id}/suspend with a fresh Idempotency-Key.
func (c *Client) SuspendMachine(ctx context.Context, id string) (Operation, error) {
	return c.lifecycleAction(ctx, id, "suspend", false)
}

// ResumeMachine calls POST /v1/machines/{id}/resume with a fresh Idempotency-Key.
func (c *Client) ResumeMachine(ctx context.Context, id string) (Operation, error) {
	return c.lifecycleAction(ctx, id, "resume", false)
}

func (c *Client) lifecycleAction(ctx context.Context, id, action string, force bool) (Operation, error) {
	path := "/v1/machines/" + url.PathEscape(id) + "/" + action
	if action == "stop" && force {
		path += "?now=true"
	}
	headers := map[string]string{
		"Idempotency-Key": uuid.NewString(),
	}
	var out Operation
	// Suspend takes no body or {}; sending nil body works cleanly across start/stop/suspend/resume.
	err := c.doJSON(ctx, c.httpClient, http.MethodPost, path, headers, nil, &out)
	return out, err
}

// GetOperation calls GET /v1/operations/{id}, optionally long-polling up to waitSeconds.
func (c *Client) GetOperation(ctx context.Context, opID string, waitSeconds int) (Operation, error) {
	path := "/v1/operations/" + url.PathEscape(opID)
	hc := c.httpClient
	if waitSeconds > 0 {
		path += "?wait=" + strconv.Itoa(waitSeconds)
		hc = c.longClient
	}
	var out Operation
	err := c.doJSON(ctx, hc, http.MethodGet, path, nil, nil, &out)
	return out, err
}

func (c *Client) doJSON(ctx context.Context, hc *http.Client, method, path string, extraHeaders map[string]string, body any, dest any) error {
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		return fmt.Errorf("create request %s %s: %w", method, path, err)
	}
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgent)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := hc.Do(req)
	if err != nil {
		return fmt.Errorf("instabox %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20)) // 10 MiB safety cap
	if err != nil {
		return fmt.Errorf("read response %s %s: %w", method, path, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return parseAPIError(resp.StatusCode, resp.Header.Get("Retry-After"), raw)
	}

	if dest == nil || len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		return fmt.Errorf("decode %s %s response: %w", method, path, err)
	}
	return nil
}

func parseAPIError(statusCode int, retryAfterHeader string, raw []byte) *APIError {
	apiErr := &APIError{StatusCode: statusCode}

	var wrapped errorBody
	if err := json.Unmarshal(raw, &wrapped); err == nil && wrapped.Error != nil {
		*apiErr = *wrapped.Error
		apiErr.StatusCode = statusCode
	} else {
		var flat APIError
		if err := json.Unmarshal(raw, &flat); err == nil && (flat.Code != "" || flat.Message != "") {
			*apiErr = flat
			apiErr.StatusCode = statusCode
		} else {
			msg := strings.TrimSpace(string(raw))
			if len(msg) > 300 {
				msg = msg[:300]
			}
			if msg == "" {
				msg = http.StatusText(statusCode)
			}
			apiErr.Message = msg
		}
	}

	if apiErr.RetryAfterSeconds == 0 && retryAfterHeader != "" {
		if sec, err := strconv.Atoi(strings.TrimSpace(retryAfterHeader)); err == nil && sec > 0 {
			apiErr.RetryAfterSeconds = sec
		}
	}
	return apiErr
}
