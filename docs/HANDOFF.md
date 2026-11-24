# Project Handoff Log

Dokumen handoff hidup yang diperbarui setiap selesai 1 fase/task sebelum merge ke `main`.

---

## Status Terkini
- **Fase Terakhir Selesai**: Phase 2 — InstaBox REST API Client (merged ke `main`)
- **Branch Aktif**: `main`
- **Target Berikutnya**: Phase 3 (`feat/phase-3-poller-sse-api`)

---

## Riwayat Fase

### Phase 2 — InstaBox REST API Client
- **Branch**: `feat/phase-2-instabox-client`
- **Ringkasan Perubahan**:
  - `internal/instabox/types.go`: seluruh struct OpenAPI InstaBox (`Me`, `Org`, `Usage`, `Machine`, `MachineMetrics`, `MachineDisk`, `ProcessList`, `MachineLogs`, `Operation`, `PublicPortList`, `APIError` + helper `IsAuthError`, `IsMissingScope`, `IsRateLimited`, `IsOperationConflict`, `RetryAfter`).
  - `internal/instabox/client.go`: client HTTP `X-API-Key` dengan cursor pagination otomatis pada `/v1/machines`, `Idempotency-Key` UUID v4 pada aksi lifecycle (`start`, `stop` + opsi Force Stop `?now=true`, `suspend`, `resume`; tanpa Delete VM), dan long-poll `GetOperation`.
  - `internal/instabox/client_test.go`: mock test suite `httptest.NewServer` memverifikasi pagination, seluruh endpoint monitoring/lifecycle, Force Stop, dan error parsing (`401`/`403`/`429`).
- **Verifikasi**: `go vet ./...` & `go test -v -race ./...` seluruhnya PASS (0 error).
- **Next Steps**: Implementasi isolated per-account Background Poller, startup freshness check, tiered metrics polling, auto-disable `401`, SSE broker, optional auth (`APP_PASSWORD`), dan REST API backend pada branch `feat/phase-3-poller-sse-api`.

### Phase 1 — Core Infrastructure: Config, Conditional Logger, `APP_KEY` Crypto & SQLite Store
- **Branch**: `feat/phase-1-core-store-crypto-log`
- **Ringkasan Perubahan**:
  - `internal/config/config.go`: parser seluruh env vars (`APP_KEY`, `APP_PASSWORD`, `APP_USERNAME`, `APP_ENV`, `POLL_INTERVAL_SECONDS`, `METRICS_POLL_INTERVAL_SECONDS`, `ACCOUNT_MAX_AUTH_FAILURES`, `ACCOUNTS_SEED_MODE`, dll.) dengan validasi & clamping aman.
  - `internal/logger/logger.go`: logger `slog` kondisional yang hanya membuat & menulis `logs/log-yyyy-mm-dd.log` (mengikuti `TZ`, rotasi harian, auto-prune 7 hari) saat `APP_ENV=DEBUG`.
  - `internal/crypto/cipher.go`: enkripsi AES-256-GCM (`APP_KEY` + fallback `.master.key` `0600`), `HashAPIKey` (`HMAC-SHA256`), dan `MaskAPIKey`.
  - `internal/store/`: SQLite pure-Go (`modernc.org/sqlite` WAL) dengan tabel `accounts`, `account_snapshots`, `sessions`, dan `activity_events`.
  - `internal/config/seed.go`: seeding hybrid ENV/YAML mendukung `sync` & `bootstrap`, proteksi penuh akun `source='ui'`, re-encrypt otomatis saat `APP_KEY` berubah di mode `sync`, serta menjaga status `auto_disabled` bila `apiKey` belum berubah.
- **Catatan Teknis**: `modernc.org/sqlite v1.63.0` meng-upgrade `go.mod` ke `go 1.26.0` (akan disesuaikan pada `golang:1.26-alpine` di Phase 5).
- **Verifikasi**: `go vet ./...` & `go test -v -race ./...` seluruhnya PASS (0 error).
- **Next Steps**: Implementasi InstaBox REST API client (`internal/instabox/`) pada branch `feat/phase-2-instabox-client`.

### Phase 0 — Bootstrap Repositori, `.gitignore` & Dokumen SDD
- **Branch**: `chore/phase-0-bootstrap-spec`
- **Ringkasan Perubahan**:
  - Inisialisasi Git pada branch `main` dengan author lokal `wawans <wawans@users.noreply.github.com>`.
  - Membuat `.gitignore` ketat yang mengabaikan `.env`, `.env.*` (kecuali `.env.example`), `accounts.yaml`/`json`, `*.key`, `.master.key`, `data/`, `logs/`, `*.log`, `*.db*`, dan build artifacts.
  - Menyusun dokumen Spec-Driven Development: `docs/SPEC.md`, `docs/TASKS.md`, `docs/HANDOFF.md`, `CHANGELOG.md`, `README.md`.
  - Menyiapkan `go.mod` (`module instabox-monitor`, `go 1.24`), `.env.example`, `accounts.example.yaml`, dan `internal/webui/dist/.gitkeep`.
- **Verifikasi**:
  - `git check-ignore` memverifikasi seluruh file sensitif & log terabaikan oleh Git.
- **Next Steps**:
  - Buat branch `feat/phase-1-core-store-crypto-log` dari `main` untuk mengimplementasikan `config`, conditional `logger`, `crypto` (`APP_KEY`), `store` (SQLite WAL), dan hybrid `seed`.
