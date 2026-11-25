# Milestone & Task Tracker (Spec-Driven Development)

Setiap fase dikerjakan pada **Git branch terpisah** dan di-merge ke `main` (`--no-ff`) hanya setelah seluruh *acceptance criteria* dan pengujian lulus 100% tanpa error.

---

## Phase 0 — Bootstrap Repositori, `.gitignore` & Dokumen SDD
**Branch:** `chore/phase-0-bootstrap-spec`

- [x] `TASK-0.1`: Inisialisasi Git (`main`), konfigurasi author lokal (`wawans`), dan `.gitignore` ketat (kredensial, database, `logs/`, build artifacts).
- [x] `TASK-0.2`: Penyusunan dokumen SDD (`docs/SPEC.md`, `docs/TASKS.md`, `docs/HANDOFF.md`, `CHANGELOG.md`, `README.md`).
- [x] `TASK-0.3`: Bootstrap `go.mod` (`instabox-monitor`), `.env.example`, `accounts.example.yaml`, dan `internal/webui/dist/.gitkeep`.
- [x] **Merge Gate Phase 0**: Verifikasi `git check-ignore`, audit `git status`, merge `--no-ff` ke `main`.

---

## Phase 1 — Core Infrastructure: Config, Conditional Logger, `APP_KEY` Crypto & SQLite Store
**Branch:** `feat/phase-1-core-store-crypto-log`

- [x] `TASK-1.1`: `internal/config/config.go` & `config_test.go` — Parsing seluruh env vars (`PORT`, `APP_ENV`, `LOG_DIR`, `DATA_DIR`, `APP_KEY`, `APP_USERNAME`, `APP_PASSWORD`, `POLL_INTERVAL_SECONDS`, `METRICS_POLL_INTERVAL_SECONDS`, `ACCOUNT_MAX_AUTH_FAILURES`, `INSTABOX_ACCOUNTS_JSON`, `INSTABOX_ACCOUNTS_FILE`, `ACCOUNTS_SEED_MODE`, `COOKIE_SECURE`).
- [x] `TASK-1.2`: `internal/logger/logger.go` & `logger_test.go` — Logger kondisional `slog` (`APP_ENV=DEBUG` menulis `logs/log-yyyy-mm-dd.log` mengikuti `TZ` + auto-prune 7 hari; `production` stdout saja tanpa file).
- [x] `TASK-1.3`: `internal/crypto/cipher.go` & `cipher_test.go` — Enkripsi AES-256-GCM (`APP_KEY` + fallback `.master.key`), `HashAPIKey` (`HMAC-SHA256`), dan `MaskAPIKey`.
- [x] `TASK-1.4`: `internal/store/` (`sqlite.go`, `accounts.go`, `snapshots.go`, `sessions.go`, `events.go`, `store_test.go`) — Pure-Go SQLite (`modernc.org/sqlite` WAL) dengan tabel `accounts`, `account_snapshots`, `sessions`, `activity_events`.
- [x] `TASK-1.5`: `internal/config/seed.go` & `seed_test.go` — Seeding hybrid (`ACCOUNTS_SEED_MODE=sync|bootstrap`), proteksi `source='ui'`, re-encrypt otomatis pada `key_error`, reset `auto_disabled` hanya bila `api_key_hash` berubah.
- [x] **Merge Gate Phase 1**: `go vet ./...`, `go test -v -race ./...`, update Handoff/Tasks/Changelog, merge `--no-ff` ke `main`.

---

## Phase 2 — InstaBox REST API Client
**Branch:** `feat/phase-2-instabox-client`

- [x] `TASK-2.1`: `internal/instabox/types.go` — Struct lengkap sesuai OpenAPI `/v1/openapi.json`.
- [x] `TASK-2.2`: `internal/instabox/client.go` — HTTP client (`X-API-Key`, pagination `cursor`, `Idempotency-Key` UUID v4, Force Stop `?now=true`, long-poll `GetOperation`, parsing `APIError` `401`/`403`/`409`/`429`).
- [x] `TASK-2.3`: `internal/instabox/client_test.go` — Mock test suite (`httptest.NewServer`) mencakup semua endpoint & error path.
- [x] **Merge Gate Phase 2**: `go vet ./...`, `go test -v -race ./...`, update Handoff/Tasks/Changelog, merge `--no-ff` ke `main`.

---

## Phase 3 — Background Poller, SSE Broker, Auth (`APP_PASSWORD`) & REST API
**Branch:** `feat/phase-3-poller-sse-api`

- [x] `TASK-3.1`: `internal/poller/` (`sse.go`, `manager.go`, `poller_test.go`) — Isolated per-account goroutine poller, startup freshness check, tiered metrics polling, non-blocking `key_error`, auto-disable setelah *N* kali `401`, backoff `429`/`5xx`, unit tests lengkap.
- [x] `TASK-3.2`: `internal/api/auth_handlers.go` — Optional session auth (`APP_PASSWORD`/`APP_USERNAME`), constant-time compare, login rate limiter, `HttpOnly` cookie.
- [x] `TASK-3.3`: `internal/api/` (`router.go`, `account_handlers.go`, `fleet_handlers.go`, `vm_handlers.go`) — Seluruh endpoint REST/SSE termasuk `POST /api/accounts/bulk` (*partial success*, `api_key_hash` skip duplicates) dan `POST /api/fleet/wake-all` (mengikuti filter aktif).
- [x] `TASK-3.4`: `cmd/server/main.go`, `internal/webui/embed.go`, `internal/api/api_test.go` — Entrypoint (`_ "time/tzdata"`, `-healthcheck`, graceful shutdown) + integration tests multi-akun.
- [x] **Merge Gate Phase 3**: `go vet ./...`, `go test -v -race ./...`, uji startup & `/api/health`, update Handoff/Tasks/Changelog, merge `--no-ff` ke `main`.

---

## Phase 4 — Frontend Dashboard SPA (React + TypeScript + Tailwind + Recharts)
**Branch:** `feat/phase-4-frontend-dashboard`

- [x] `TASK-4.1`: Setup proyek `web/` (React 19, TypeScript, Vite, Tailwind CSS v4, Recharts, Lucide, English UI).
- [x] `TASK-4.2`: API client, SSE hook, format helpers, `Layout`, `StateBadge`, `MetricBar`, `LoginPage`.
- [x] `TASK-4.3`: `FleetPage` & `LifecycleControls` — KPI summary, filter akun/org/state/search, `Wake All (N)`, **Card view mobile (`< 768px`)** & **Table view desktop/tablet (`>= 768px`)**, 1-klik Start/Resume, konfirmasi Pause/Stop (dengan opsi Force Stop), live operation tracker.
- [x] `TASK-4.4`: `VMDetailPage`, `MetricCharts`, `PortsPage`, `AccountsPage`, `AccountModal` (2 tab: `Single` | `Bulk Import` CSV/JSON/YAML + upload + preview + validasi opsional, badge `Auto-Disabled (401)` & `Key Error`).
- [x] `TASK-4.5`: Build & embed `web/dist` ke `internal/webui/dist` + verifikasi full-stack lokal.
- [x] **Merge Gate Phase 4**: `pnpm --dir web typecheck && pnpm --dir web build`, `go vet ./...`, `go test -v -race ./...`, update Handoff/Tasks/Changelog, merge `--no-ff` ke `main`.

---

## Phase 5 — Multi-Arch Docker, GitHub Workflow (GHCR) & Deployment User Guide
**Branch:** `build/phase-5-docker-ghcr-docs`

- [x] `TASK-5.1`: `Dockerfile` (multi-stage, `CGO_ENABLED=0`, distroless non-root, `-healthcheck`) & `.dockerignore`.
- [x] `TASK-5.2`: `.github/workflows/docker-publish.yml` — Test + build & publish multi-arch (`linux/amd64`, `linux/arm64`) ke `ghcr.io/wawans/instabox-monitor`.
- [x] `TASK-5.3`: `docker-compose.yml` (GHCR image), `docker-compose.local.yml`, `Makefile`, `scripts/build-multiarch.sh`.
- [x] `TASK-5.4`: `docs/DEPLOYMENT_GUIDE.md` (Panduan Pengguna Deployment GHCR lengkap dalam Bahasa Indonesia) & pembaruan final `README.md`.
- [x] `TASK-5.5`: Validasi end-to-end (cross-compile `amd64`/`arm64`, Docker build, smoke test `production` vs `APP_ENV=DEBUG`, `buildx` multi-arch, audit keamanan Git), update final Handoff/Tasks/Changelog, merge `--no-ff` ke `main`.

---

## Phase 6 — Port Publishing & Management
**Branch:** `feat/phase-6-port-publishing`

- [x] `TASK-6.1`: Client & tipe port publishing (`PublishPortRequest`, `PublicPort.Token`, `ListMachinePorts`, `PublishPort`, `UnpublishPort`) + unit test `TestClientPortPublishingAndUnpublish`.
- [x] `TASK-6.2`: Poller port cache helpers (`SanitizePublicPort`, `UpsertCachedPort`, `RemoveCachedPort`, sanitasi defensif di `pollOnce` & `decodeSnapshot`) + `TestPortCacheUpsertStripsTokenAndRemoveUpdatesSnapshot`.
- [x] `TASK-6.3`: Internal REST API port management (`internal/api/port_handlers.go`, route `GET/POST/DELETE` di `router.go`, validasi `1024..65535`/reserved `5901`,`6768`/`tcp+private`/`rotateToken+public`, adaptif `403 missing_scope`, zero-leak policy) + `TestAppPortPublishRotateUnpublishAndZeroLeak`.
- [x] `TASK-6.4`: Upgrade UI manajemen port di **Ports** (`/ports`), `PublishPortModal` (+ **One-Time Private Token Reveal** modal, Rotate Token, Unpublish, 4 KPI, `List | Grouped by VM`, URL filter, mobile cards & desktop table) dan **VM Detail** tab `Ports & Details`.
- [x] `TASK-6.5`: Pembaruan dokumen (`SPEC.md`, `TASKS.md`, `HANDOFF.md`, `CHANGELOG.md`, `README.md`, `walkthrough.md`) + verifikasi Merge Gate Phase 6 & `--no-ff` merge ke `main`.
