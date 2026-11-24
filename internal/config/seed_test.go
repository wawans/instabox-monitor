package config

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"instabox-monitor/internal/crypto"
	"instabox-monitor/internal/store"
)

func TestSeedAccountsSyncBootstrapUIProtectionAndAutoDisabled(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	defer st.Close()

	ciph, err := crypto.New("test-app-key-1", dir)
	if err != nil {
		t.Fatalf("crypto.New: %v", err)
	}

	// Pre-create a UI-managed account with slug "ui-owned"
	uiEnc, _ := ciph.Encrypt("ibk_ui_original_1111")
	_, err = st.CreateAccount(ctx, store.Account{
		ID:         "ui-1",
		Slug:       "ui-owned",
		Name:       "UI Managed",
		APIKeyEnc:  uiEnc,
		APIKeyHash: ciph.HashAPIKey("ibk_ui_original_1111"),
		KeyHint:    crypto.MaskAPIKey("ibk_ui_original_1111"),
		Enabled:    true,
		Source:     store.SourceUI,
	})
	if err != nil {
		t.Fatalf("CreateAccount(ui): %v", err)
	}

	// Write YAML seed file with 2 accounts: 1 new seed, 1 conflicting with ui-owned
	yamlPath := filepath.Join(dir, "accounts.yaml")
	yamlContent := `accounts:
  - slug: prod
    name: Prod Initial
    apiKey: ibk_prod_key_v1_aaaa
    readOnly: false
  - slug: ui-owned
    name: Attempt Overwrite UI
    apiKey: ibk_attempt_overwrite
`
	if err := os.WriteFile(yamlPath, []byte(yamlContent), 0o600); err != nil {
		t.Fatalf("write yaml: %v", err)
	}

	cfg := Config{
		AccountsFile:     yamlPath,
		AccountsSeedMode: SeedModeSync,
	}

	res, err := SeedAccounts(ctx, cfg, st, ciph, nil)
	if err != nil {
		t.Fatalf("SeedAccounts #1: %v", err)
	}
	if res.Created != 1 || res.Skipped != 1 {
		t.Fatalf("Seed #1 result = %+v, want Created=1 Skipped=1", res)
	}

	// UI account must be untouched
	uiAcc, _ := st.GetAccountBySlug(ctx, "ui-owned")
	if uiAcc.Name != "UI Managed" {
		t.Fatalf("UI account was overwritten: %+v", uiAcc)
	}

	// Simulate prod account getting auto_disabled due to 401
	prodAcc, _ := st.GetAccountBySlug(ctx, "prod")
	prodAcc.Enabled = false
	prodAcc.LastSyncStatus = store.StatusAutoDisabled
	prodAcc.ConsecutiveAuthFailures = 3
	prodAcc.DisabledReason = "Auto-disabled after 3 consecutive 401 errors"
	_, _ = st.UpdateAccount(ctx, prodAcc)

	// Re-run sync with SAME apiKey -> must keep auto_disabled = true (enabled = false)
	if _, err := SeedAccounts(ctx, cfg, st, ciph, nil); err != nil {
		t.Fatalf("SeedAccounts same-key sync: %v", err)
	}
	prodAfterSame, _ := st.GetAccountBySlug(ctx, "prod")
	if prodAfterSame.Enabled || prodAfterSame.LastSyncStatus != store.StatusAutoDisabled {
		t.Fatalf("expected auto_disabled to remain when apiKey unchanged: %+v", prodAfterSame)
	}

	// Now test BOOTSTRAP mode with rotated key -> must be skipped (DB wins)
	cfgBootstrap := Config{
		AccountsJSON:     `[{"slug":"prod","name":"Prod Bootstrap Ignored","apiKey":"ibk_prod_key_v2_bbbb"}]`,
		AccountsSeedMode: SeedModeBootstrap,
	}
	resBoot, err := SeedAccounts(ctx, cfgBootstrap, st, ciph, nil)
	if err != nil {
		t.Fatalf("SeedAccounts bootstrap: %v", err)
	}
	if resBoot.Skipped != 1 || resBoot.Updated != 0 {
		t.Fatalf("bootstrap result = %+v, want Skipped=1 Updated=0", resBoot)
	}
	prodAfterBoot, _ := st.GetAccountBySlug(ctx, "prod")
	if prodAfterBoot.Name != "Prod Initial" {
		t.Fatalf("bootstrap mode should not update existing account: %+v", prodAfterBoot)
	}

	// Now test SYNC mode with rotated key -> must update, re-enable, and reset auth failures
	cfgRotate := Config{
		AccountsJSON:     `[{"slug":"prod","name":"Prod Rotated","apiKey":"ibk_prod_key_v2_bbbb","readOnly":true}]`,
		AccountsSeedMode: SeedModeSync,
	}
	resRot, err := SeedAccounts(ctx, cfgRotate, st, ciph, nil)
	if err != nil {
		t.Fatalf("SeedAccounts rotate sync: %v", err)
	}
	if resRot.Updated != 1 {
		t.Fatalf("rotate result = %+v, want Updated=1", resRot)
	}
	prodRotated, _ := st.GetAccountBySlug(ctx, "prod")
	if prodRotated.Name != "Prod Rotated" || !prodRotated.Enabled || !prodRotated.ReadOnly ||
		prodRotated.ConsecutiveAuthFailures != 0 || prodRotated.LastSyncStatus != store.StatusPending {
		t.Fatalf("rotated account mismatch: %+v", prodRotated)
	}

	// Test key_error recovery on sync mode when APP_KEY changes
	ciphNew, _ := crypto.New("brand-new-app-key", dir)
	resReenc, err := SeedAccounts(ctx, cfgRotate, st, ciphNew, nil)
	if err != nil {
		t.Fatalf("SeedAccounts re-encrypt on new APP_KEY: %v", err)
	}
	if resReenc.Updated != 1 {
		t.Fatalf("expected Updated=1 on new APP_KEY, got %+v", resReenc)
	}
	prodReenc, _ := st.GetAccountBySlug(ctx, "prod")
	plain, err := ciphNew.Decrypt(prodReenc.APIKeyEnc)
	if err != nil || plain != "ibk_prod_key_v2_bbbb" {
		t.Fatalf("re-encrypted decrypt = (%q, %v)", plain, err)
	}
}
