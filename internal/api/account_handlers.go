package api

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"gopkg.in/yaml.v3"

	"instabox-monitor/internal/config"
	"instabox-monitor/internal/crypto"
	"instabox-monitor/internal/instabox"
	"instabox-monitor/internal/poller"
	"instabox-monitor/internal/store"
)

type accountResponse struct {
	ID                      string         `json:"id"`
	Slug                    string         `json:"slug,omitempty"`
	Name                    string         `json:"name"`
	BaseURL                 string         `json:"baseUrl"`
	KeyHint                 string         `json:"keyHint"`
	Enabled                 bool           `json:"enabled"`
	ReadOnly                bool           `json:"readOnly"`
	WriteCapable            *bool          `json:"writeCapable"`
	CanWrite                bool           `json:"canWrite"`
	Source                  string         `json:"source"`
	UserLogin               string         `json:"userLogin"`
	UserEmail               string         `json:"userEmail"`
	Orgs                    []instabox.Org `json:"orgs"`
	LastSyncAt              *time.Time     `json:"lastSyncAt"`
	LastSyncStatus          string         `json:"lastSyncStatus"`
	LastError               string         `json:"lastError"`
	ConsecutiveAuthFailures int            `json:"consecutiveAuthFailures"`
	MaxAuthFailures         int            `json:"maxAuthFailures"`
	DisabledReason          string         `json:"disabledReason"`
	CreatedAt               time.Time      `json:"createdAt"`
	UpdatedAt               time.Time      `json:"updatedAt"`
}

func (s *Server) toAccountResponse(a store.Account) accountResponse {
	return s.toAccountResponseWithSnapshot(a, nil)
}

func (s *Server) toAccountResponseWithSnapshot(a store.Account, snap *poller.AccountCache) accountResponse {
	var orgs []instabox.Org
	if a.OrgsJSON != "" {
		_ = json.Unmarshal([]byte(a.OrgsJSON), &orgs)
	}
	orgs = enrichAccountOrgsFromSnapshot(orgs, snap)
	return accountResponse{
		ID:                      a.ID,
		Slug:                    a.Slug,
		Name:                    a.Name,
		BaseURL:                 a.BaseURL,
		KeyHint:                 a.KeyHint,
		Enabled:                 a.Enabled,
		ReadOnly:                a.ReadOnly,
		WriteCapable:            a.WriteCapable,
		CanWrite:                a.CanWrite(),
		Source:                  a.Source,
		UserLogin:               a.UserLogin,
		UserEmail:               a.UserEmail,
		Orgs:                    orgs,
		LastSyncAt:              a.LastSyncAt,
		LastSyncStatus:          a.LastSyncStatus,
		LastError:               a.LastError,
		ConsecutiveAuthFailures: a.ConsecutiveAuthFailures,
		MaxAuthFailures:         s.cfg.AccountMaxAuthFailures,
		DisabledReason:          a.DisabledReason,
		CreatedAt:               a.CreatedAt,
		UpdatedAt:               a.UpdatedAt,
	}
}

func enrichAccountOrgsFromSnapshot(orgs []instabox.Org, snap *poller.AccountCache) []instabox.Org {
	if orgs == nil {
		orgs = []instabox.Org{}
	}
	if snap == nil {
		return orgs
	}

	totalByOrg := make(map[string]int)
	runningByOrg := make(map[string]int)
	diskGiBByOrg := make(map[string]int)
	for _, vm := range snap.Machines {
		totalByOrg[vm.OrgID]++
		if vm.State == "running" || vm.State == "starting" {
			runningByOrg[vm.OrgID]++
		}
		disk := vm.Spec.PersistentDiskGiB
		if vm.Storage != nil && vm.Storage.SizeGiB > 0 {
			disk = vm.Storage.SizeGiB
		}
		diskGiBByOrg[vm.OrgID] += disk
	}

	out := make([]instabox.Org, len(orgs))
	for i, org := range orgs {
		out[i] = org
		var usage instabox.OrgUsage
		if org.Usage != nil {
			usage = *org.Usage
		}
		usage.Machines = totalByOrg[org.ID]
		usage.Running = runningByOrg[org.ID]
		if usage.AllocatedDiskGiB == 0 && diskGiBByOrg[org.ID] > 0 {
			usage.AllocatedDiskGiB = diskGiBByOrg[org.ID]
		}
		out[i].Usage = &usage
	}

	if len(out) == 0 && len(totalByOrg) > 0 {
		ids := make([]string, 0, len(totalByOrg))
		for id := range totalByOrg {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			name := id
			if name == "" {
				name = "Default"
			}
			out = append(out, instabox.Org{
				ID:   id,
				Name: name,
				Usage: &instabox.OrgUsage{
					Machines:         totalByOrg[id],
					Running:          runningByOrg[id],
					AllocatedDiskGiB: diskGiBByOrg[id],
				},
			})
		}
	}
	return out
}

func validateBaseURL(raw string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	if trimmed == "" {
		return instabox.DefaultBaseURL, nil
	}
	u, err := url.Parse(trimmed)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return "", errors.New("baseUrl must be a valid http(s) URL")
	}
	return trimmed, nil
}

func (s *Server) handleListAccounts(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.store.ListAccounts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	snaps := s.poller.SnapshotCopy()
	resp := make([]accountResponse, 0, len(accounts))
	for _, a := range accounts {
		var snapPtr *poller.AccountCache
		if snap, ok := snaps[a.ID]; ok {
			snapPtr = &snap
		}
		resp = append(resp, s.toAccountResponseWithSnapshot(a, snapPtr))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"accounts": resp,
		"seedMode": s.cfg.AccountsSeedMode,
	})
}

func (s *Server) handleTestAccount(w http.ResponseWriter, r *http.Request) {
	var req struct {
		APIKey  string `json:"apiKey"`
		BaseURL string `json:"baseUrl"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON payload")
		return
	}
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "apiKey is required")
		return
	}
	baseURL, err := validateBaseURL(req.BaseURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}

	client := instabox.NewClient(baseURL, apiKey)
	me, err := client.GetMe(r.Context())
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	orgs, _ := client.ListOrgs(r.Context())
	if orgs == nil {
		orgs = []instabox.Org{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"me":   me,
		"orgs": orgs,
	})
}

func (s *Server) handleCreateAccount(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string `json:"name"`
		Slug     string `json:"slug"`
		APIKey   string `json:"apiKey"`
		BaseURL  string `json:"baseUrl"`
		ReadOnly bool   `json:"readOnly"`
		Enabled  *bool  `json:"enabled"`
		Validate bool   `json:"validate"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON payload")
		return
	}
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "apiKey is required")
		return
	}
	baseURL, err := validateBaseURL(req.BaseURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}

	keyHash := s.cipher.HashAPIKey(apiKey)
	if existing, err := s.store.FindAccountByAPIKeyHash(r.Context(), keyHash); err == nil {
		writeError(w, http.StatusConflict, "duplicate_api_key", fmt.Sprintf("API key is already registered under account %q", existing.Name))
		return
	}

	name := strings.TrimSpace(req.Name)
	var userLogin, userEmail, orgsJSON string
	if req.Validate || name == "" {
		client := instabox.NewClient(baseURL, apiKey)
		me, err := client.GetMe(r.Context())
		if err != nil {
			if req.Validate {
				writeUpstreamError(w, err)
				return
			}
		} else {
			userLogin = me.Login
			userEmail = me.Email
			if name == "" {
				if me.Login != "" {
					name = me.Login
				} else if me.Email != "" {
					name = me.Email
				}
			}
			if orgs, oErr := client.ListOrgs(r.Context()); oErr == nil {
				if b, jErr := json.Marshal(orgs); jErr == nil {
					orgsJSON = string(b)
				}
			}
		}
	}
	if name == "" {
		name = "Account " + crypto.MaskAPIKey(apiKey)
	}

	enc, err := s.cipher.Encrypt(apiKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "failed to encrypt API key")
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	acc, err := s.store.CreateAccount(r.Context(), store.Account{
		ID:             uuid.NewString(),
		Slug:           config.NormalizeSlug(req.Slug),
		Name:           name,
		BaseURL:        baseURL,
		APIKeyEnc:      enc,
		APIKeyHash:     keyHash,
		KeyHint:        crypto.MaskAPIKey(apiKey),
		Enabled:        enabled,
		ReadOnly:       req.ReadOnly,
		Source:         store.SourceUI,
		UserLogin:      userLogin,
		UserEmail:      userEmail,
		OrgsJSON:       orgsJSON,
		LastSyncStatus: store.StatusPending,
	})
	if errors.Is(err, store.ErrDuplicate) {
		writeError(w, http.StatusConflict, "duplicate_slug", "an account with that slug already exists")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	s.poller.ReconcileAccount(r.Context(), acc.ID)
	writeJSON(w, http.StatusCreated, s.toAccountResponse(acc))
}

type bulkAccountItem struct {
	Name     string `json:"name" yaml:"name"`
	Slug     string `json:"slug" yaml:"slug"`
	APIKey   string `json:"apiKey" yaml:"apiKey"`
	BaseURL  string `json:"baseUrl" yaml:"baseUrl"`
	ReadOnly bool   `json:"readOnly" yaml:"readOnly"`
	Enabled  *bool  `json:"enabled" yaml:"enabled"`
}

type bulkAccountResult struct {
	Index     int    `json:"index"`
	Name      string `json:"name"`
	KeyHint   string `json:"keyHint,omitempty"`
	AccountID string `json:"accountId,omitempty"`
	Status    string `json:"status"` // created, skipped, failed
	Reason    string `json:"reason,omitempty"`
}

func (s *Server) handleBulkCreateAccounts(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Items    []bulkAccountItem `json:"items"`
		Raw      string            `json:"raw"`
		Validate bool              `json:"validate"`
		ReadOnly bool              `json:"readOnly"`
		BaseURL  string            `json:"baseUrl"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON payload")
		return
	}

	items := req.Items
	if len(items) == 0 && strings.TrimSpace(req.Raw) != "" {
		parsed, err := parseBulkRawInput(req.Raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "parse_error", err.Error())
			return
		}
		items = parsed
	}
	if len(items) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "no accounts provided")
		return
	}
	if len(items) > 100 {
		writeError(w, http.StatusBadRequest, "too_many_items", "maximum 100 accounts per bulk import")
		return
	}

	defaultBaseURL, err := validateBaseURL(req.BaseURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}

	// Pre-populate existing hashes from DB for accurate duplicate skip (HMAC-SHA256).
	existingAccounts, err := s.store.ListAccounts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	seenHashes := make(map[string]string, len(existingAccounts))
	seenSlugs := make(map[string]struct{}, len(existingAccounts))
	for _, a := range existingAccounts {
		if a.APIKeyHash != "" {
			seenHashes[a.APIKeyHash] = a.Name
		}
		if a.Slug != "" {
			seenSlugs[a.Slug] = struct{}{}
		}
	}

	// Optional bounded parallel /v1/me validation before persistence.
	type validationOut struct {
		me       instabox.Me
		orgsJSON string
		err      error
	}
	validated := make([]validationOut, len(items))
	if req.Validate {
		var wg sync.WaitGroup
		sem := make(chan struct{}, 5)
		for i, item := range items {
			apiKey := strings.TrimSpace(item.APIKey)
			if apiKey == "" {
				continue
			}
			keyHash := s.cipher.HashAPIKey(apiKey)
			if _, dup := seenHashes[keyHash]; dup {
				continue
			}
			i, item := i, item
			wg.Add(1)
			go func() {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				bu := defaultBaseURL
				if strings.TrimSpace(item.BaseURL) != "" {
					if v, vErr := validateBaseURL(item.BaseURL); vErr == nil {
						bu = v
					} else {
						validated[i].err = vErr
						return
					}
				}
				c := instabox.NewClient(bu, apiKey)
				me, mErr := c.GetMe(r.Context())
				if mErr != nil {
					validated[i].err = mErr
					return
				}
				validated[i].me = me
				if orgs, oErr := c.ListOrgs(r.Context()); oErr == nil {
					if b, jErr := json.Marshal(orgs); jErr == nil {
						validated[i].orgsJSON = string(b)
					}
				}
			}()
		}
		wg.Wait()
	}

	results := make([]bulkAccountResult, 0, len(items))
	var createdIDs []string
	var createdCount, skippedCount, failedCount int

	for i, item := range items {
		apiKey := strings.TrimSpace(item.APIKey)
		name := strings.TrimSpace(item.Name)
		hint := crypto.MaskAPIKey(apiKey)

		if apiKey == "" {
			failedCount++
			results = append(results, bulkAccountResult{
				Index: i, Name: name, Status: "failed", Reason: "missing apiKey",
			})
			continue
		}

		bu := defaultBaseURL
		if strings.TrimSpace(item.BaseURL) != "" {
			v, vErr := validateBaseURL(item.BaseURL)
			if vErr != nil {
				failedCount++
				results = append(results, bulkAccountResult{
					Index: i, Name: name, KeyHint: hint, Status: "failed", Reason: vErr.Error(),
				})
				continue
			}
			bu = v
		}

		keyHash := s.cipher.HashAPIKey(apiKey)
		if existingName, dup := seenHashes[keyHash]; dup {
			skippedCount++
			results = append(results, bulkAccountResult{
				Index: i, Name: name, KeyHint: hint, Status: "skipped",
				Reason: fmt.Sprintf("duplicate API key (matches %q)", existingName),
			})
			continue
		}

		slug := config.NormalizeSlug(item.Slug)
		if slug != "" {
			if _, dup := seenSlugs[slug]; dup {
				skippedCount++
				results = append(results, bulkAccountResult{
					Index: i, Name: name, KeyHint: hint, Status: "skipped",
					Reason: fmt.Sprintf("duplicate slug %q", slug),
				})
				continue
			}
		}

		if req.Validate && validated[i].err != nil {
			failedCount++
			results = append(results, bulkAccountResult{
				Index: i, Name: name, KeyHint: hint, Status: "failed",
				Reason: validated[i].err.Error(),
			})
			continue
		}

		var userLogin, userEmail, orgsJSON string
		if req.Validate {
			userLogin = validated[i].me.Login
			userEmail = validated[i].me.Email
			orgsJSON = validated[i].orgsJSON
			if name == "" {
				if userLogin != "" {
					name = userLogin
				} else if userEmail != "" {
					name = userEmail
				}
			}
		}
		if name == "" {
			name = fmt.Sprintf("Account %s", hint)
		}

		enc, encErr := s.cipher.Encrypt(apiKey)
		if encErr != nil {
			failedCount++
			results = append(results, bulkAccountResult{
				Index: i, Name: name, KeyHint: hint, Status: "failed", Reason: "encryption failed",
			})
			continue
		}

		enabled := true
		if item.Enabled != nil {
			enabled = *item.Enabled
		}
		readOnly := item.ReadOnly || req.ReadOnly

		acc, createErr := s.store.CreateAccount(r.Context(), store.Account{
			ID:             uuid.NewString(),
			Slug:           slug,
			Name:           name,
			BaseURL:        bu,
			APIKeyEnc:      enc,
			APIKeyHash:     keyHash,
			KeyHint:        hint,
			Enabled:        enabled,
			ReadOnly:       readOnly,
			Source:         store.SourceUI,
			UserLogin:      userLogin,
			UserEmail:      userEmail,
			OrgsJSON:       orgsJSON,
			LastSyncStatus: store.StatusPending,
		})
		if createErr != nil {
			if errors.Is(createErr, store.ErrDuplicate) {
				skippedCount++
				results = append(results, bulkAccountResult{
					Index: i, Name: name, KeyHint: hint, Status: "skipped", Reason: "duplicate account",
				})
				continue
			}
			failedCount++
			results = append(results, bulkAccountResult{
				Index: i, Name: name, KeyHint: hint, Status: "failed", Reason: createErr.Error(),
			})
			continue
		}

		seenHashes[keyHash] = acc.Name
		if slug != "" {
			seenSlugs[slug] = struct{}{}
		}
		createdIDs = append(createdIDs, acc.ID)
		createdCount++
		results = append(results, bulkAccountResult{
			Index: i, Name: acc.Name, KeyHint: hint, AccountID: acc.ID, Status: "created",
		})
	}

	for _, id := range createdIDs {
		s.poller.ReconcileAccount(r.Context(), id)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"total":   len(items),
		"created": createdCount,
		"skipped": skippedCount,
		"failed":  failedCount,
		"results": results,
	})
}

func parseBulkRawInput(raw string) ([]bulkAccountItem, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("input is empty")
	}

	// 1. JSON array or {"accounts": [...]}
	if strings.HasPrefix(trimmed, "[") || strings.HasPrefix(trimmed, "{") {
		var wrapper struct {
			Accounts []bulkAccountItem `json:"accounts"`
		}
		if err := json.Unmarshal([]byte(trimmed), &wrapper); err == nil && len(wrapper.Accounts) > 0 {
			return wrapper.Accounts, nil
		}
		var arr []bulkAccountItem
		if err := json.Unmarshal([]byte(trimmed), &arr); err == nil && len(arr) > 0 {
			return arr, nil
		}
	}

	// 2. YAML accounts: [...] or list of objects with apiKey
	if strings.Contains(trimmed, "apiKey:") {
		var wrapper struct {
			Accounts []bulkAccountItem `yaml:"accounts"`
		}
		if err := yaml.Unmarshal([]byte(trimmed), &wrapper); err == nil && len(wrapper.Accounts) > 0 {
			return wrapper.Accounts, nil
		}
		var arr []bulkAccountItem
		if err := yaml.Unmarshal([]byte(trimmed), &arr); err == nil && len(arr) > 0 {
			return arr, nil
		}
	}

	// 3. Line-by-line CSV / plain text:
	// - "ibk_xxxx"
	// - "Account Name, ibk_xxxx"
	// - "Account Name, ibk_xxxx, readonly"
	// - "Account Name, ibk_xxxx, readonly, https://custom.api"
	var out []bulkAccountItem
	lines := strings.Split(trimmed, "\n")
	for idx, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		r := csv.NewReader(strings.NewReader(line))
		r.FieldsPerRecord = -1
		r.TrimLeadingSpace = true
		cols, err := r.Read()
		if err != nil {
			// Fallback to simple comma split
			cols = strings.Split(line, ",")
		}
		for j := range cols {
			cols[j] = strings.TrimSpace(cols[j])
		}
		// Skip header line like "name,apiKey,readOnly"
		if idx == 0 && len(cols) >= 2 && strings.EqualFold(cols[0], "name") && strings.Contains(strings.ToLower(cols[1]), "key") {
			continue
		}

		var item bulkAccountItem
		if len(cols) == 1 {
			item.APIKey = cols[0]
		} else {
			item.Name = cols[0]
			item.APIKey = cols[1]
			if len(cols) >= 3 {
				flag := strings.ToLower(cols[2])
				if flag == "readonly" || flag == "read-only" || flag == "ro" || flag == "true" || flag == "1" {
					item.ReadOnly = true
				}
			}
			if len(cols) >= 4 && cols[3] != "" {
				item.BaseURL = cols[3]
			}
		}
		out = append(out, item)
	}
	if len(out) == 0 {
		return nil, errors.New("could not parse any account entries from input")
	}
	return out, nil
}

func (s *Server) handleUpdateAccount(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	existing, err := s.store.GetAccount(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "account not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	var req struct {
		Name     *string `json:"name"`
		APIKey   *string `json:"apiKey"`
		BaseURL  *string `json:"baseUrl"`
		ReadOnly *bool   `json:"readOnly"`
		Enabled  *bool   `json:"enabled"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON payload")
		return
	}

	updated := existing
	if req.Name != nil && strings.TrimSpace(*req.Name) != "" {
		updated.Name = strings.TrimSpace(*req.Name)
	}
	if req.BaseURL != nil {
		bu, vErr := validateBaseURL(*req.BaseURL)
		if vErr != nil {
			writeError(w, http.StatusBadRequest, "bad_request", vErr.Error())
			return
		}
		updated.BaseURL = bu
	}
	if req.ReadOnly != nil {
		updated.ReadOnly = *req.ReadOnly
	}
	if req.Enabled != nil {
		updated.Enabled = *req.Enabled
		// Manual re-enable clears auto_disabled state and resets consecutive 401 failure counter.
		if *req.Enabled && !existing.Enabled {
			updated.ConsecutiveAuthFailures = 0
			updated.DisabledReason = ""
			updated.LastError = ""
			if updated.LastSyncStatus == store.StatusAutoDisabled || updated.LastSyncStatus == store.StatusAuthError {
				updated.LastSyncStatus = store.StatusPending
			}
		}
	}
	if req.APIKey != nil && strings.TrimSpace(*req.APIKey) != "" {
		newKey := strings.TrimSpace(*req.APIKey)
		newHash := s.cipher.HashAPIKey(newKey)
		if dup, dupErr := s.store.FindAccountByAPIKeyHash(r.Context(), newHash); dupErr == nil && dup.ID != existing.ID {
			writeError(w, http.StatusConflict, "duplicate_api_key", fmt.Sprintf("API key is already registered under account %q", dup.Name))
			return
		}
		enc, encErr := s.cipher.Encrypt(newKey)
		if encErr != nil {
			writeError(w, http.StatusInternalServerError, "internal", "failed to encrypt API key")
			return
		}
		updated.APIKeyEnc = enc
		updated.APIKeyHash = newHash
		updated.KeyHint = crypto.MaskAPIKey(newKey)
		updated.WriteCapable = nil
		updated.ConsecutiveAuthFailures = 0
		updated.DisabledReason = ""
		updated.LastError = ""
		updated.LastSyncStatus = store.StatusPending
		if req.Enabled == nil && (existing.LastSyncStatus == store.StatusAutoDisabled || existing.LastSyncStatus == store.StatusKeyError) {
			updated.Enabled = true
		}
	}

	saved, err := s.store.UpdateAccount(r.Context(), updated)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.poller.ReconcileAccount(r.Context(), saved.ID)
	writeJSON(w, http.StatusOK, s.toAccountResponse(saved))
}

func (s *Server) handleDeleteAccount(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.store.DeleteAccount(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "account not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.poller.ReconcileAccount(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleSyncAccount(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	acc, err := s.store.GetAccount(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "account not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if !acc.Enabled {
		writeError(w, http.StatusConflict, "account_disabled", "account is disabled; enable it before syncing")
		return
	}
	syncCtx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	_ = s.poller.SyncAndWait(syncCtx, id)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "accountId": id})
}

func (s *Server) handleSyncAll(w http.ResponseWriter, r *http.Request) {
	syncCtx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	_ = s.poller.SyncAndWait(syncCtx, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

var _ context.Context
