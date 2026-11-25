# Project Handoff Log

Dokumen handoff hidup yang diperbarui setiap selesai 1 fase/task sebelum merge ke `main`.

---

## Status Terkini
- **Fase Terakhir Selesai**: Phase 6.1 — Ports Refinement, Fleet UI Polish, RFC 3339 Metrics & Account Sync Fixes (SELESAI & merged ke `main`)
- **Branch Aktif**: `main`
- **Status Proyek**: Manajemen **Exposed Ports** (`/ports` & VM Detail), tampilan daftar VM **Fleet** tanpa `vm.orgName` (dropdown `All Orgs` tetap dipertahankan), normalisasi query metrik **RFC 3339** (`VM Detail` & `poller`), serta sinkronisasi jumlah VM live per-org pada halaman **Accounts** (`GetOrg` + `SyncAndWait` + SSE auto-refresh) selesai dan lolos seluruh Merge Gate, siap di-push ke `origin main` bila diperlukan.

---

## Riwayat Fase

### Phase 6.1 — Ports Refinement, Fleet UI Polish, RFC 3339 Metrics & Account Sync Fixes
- **Branch**: `feat/phase-6-ports-polish`
- **Ringkasan Perubahan**:
  - `internal/instabox/client.go`, `types.go`, `client_test.go`, `internal/poller/manager.go`, `poller_test.go`, `internal/api/account_handlers.go`, `fleet_handlers.go`, `vm_handlers.go`, `api_test.go`, `web/src/pages/AccountsPage.tsx`, `web/src/App.tsx`: Memperbaiki ketidaksinkronan `VMs: 0 Running: 0` di halaman **Accounts** dengan menambahkan `GetOrg` (`GET /v1/orgs/{id}`), field `FreeSandboxes`/`FreeMachines`, `enrichAccountOrgsFromSnapshot` (menghitung langsung VM free+paid & `allocatedDiskGiB` dari snapshot poller), blocking `SyncAndWait` pada `POST /api/accounts/{id}/sync` & `POST /api/fleet/sync`, serta SSE auto-refresh (`fleetGeneratedAt`) + animasi spinner Sync pada `AccountsPage`.
  - `internal/instabox/client.go`, `client_test.go`, `internal/api/vm_handlers.go`, `internal/poller/poller_test.go`, `internal/api/api_test.go`: Menambahkan `instabox.NormalizeMetricsSince` untuk mengonversi durasi relatif (`2m`/`15m`/`1h`/`6h`/`24h`) ke timestamp **RFC 3339** UTC (clamp maks `23h59m30s`) serta validasi `400 invalid_since` guna memperbaiki error `since must be an RFC 3339 time` pada tab **VM Detail Metrics** sekaligus live telemetry **Background Poller**.
  - `internal/poller/manager.go` & `internal/api/port_handlers.go`: Menambahkan `ReplaceMachineCachedPorts` dan integrasi di `handleListMachinePorts` untuk menyinkronkan live ports per-VM ke cache/SQLite tanpa membocorkan secret token dan tanpa SSE broadcast duplikat (`publicPortsEqual`).
  - `web/src/components/PortEndpoint.tsx` & `PublishPortModal.tsx`: Menambahkan komponen endpoint khusus HTTP vs **TCP TLS SNI** (menghilangkan tautan `tls://` yang rusak, menampilkan `SNI` + tombol Copy **`openssl`** & **`psql`**), deteksi port duplikat & konflik protokol (`409`) di mode Create dengan tombol cepat *Switch to Edit*, serta batas `maxLength=100` pada nama port.
  - `web/src/pages/PortsPage.tsx`, `VMDetailPage.tsx`, `FleetPage.tsx`, `App.tsx`: Menambahkan toggle opsional **`Show VMs with 0 ports`** di `Grouped by VM`, quick 1-klik **`Start VM` / `Wake VM`** di samping badge offline `503` (terhubung ke `activeOps`), toast feedback aksi port, kolom `Created` + sortable columns, reset error banner saat berpindah tab di VM Detail, serta menghapus tampilan `vm.orgName` dari daftar VM di **Fleet** (mobile card & desktop table) tanpa mengubah dropdown filter `All Orgs`.
  - Dokumentasi: Pembaruan `docs/SPEC.md`, `docs/TASKS.md`, `docs/HANDOFF.md`, `CHANGELOG.md`, dan `walkthrough.md`.
- **Verifikasi End-to-End**:
  - `go vet ./...` & `go test -count=1 -race ./...`: 7/7 package PASS (0 error, 0 race).
  - `pnpm --dir web typecheck && pnpm --dir web build`: `tsc --noEmit` Exit 0, Vite production build selesai dalam `4.52s` (`dist/assets/index-okvUuggN.js 884.41 kB`).
  - Cross-compile statis (`CGO_ENABLED=0` dengan embedded `web/dist`): `linux/amd64` (`14M` stripped) & `linux/arm64` (`13M` stripped) PASS.
  - `docker build -t instabox-monitor:local .`: Image distroless `25,038,389` bytes (~25.0 MB) PASS.
  - Container smoke test (`APP_ENV=production`): `/api/health` `200 OK`, `/` embedded SPA `<title>InstaBox Monitor — Multi-Account VM Fleet</title>`, `-healthcheck` exit `0`, serta `PROD_LOG_FILES=0` (via bind-mount `/app/logs`).
  - Audit keamanan Git (`git ls-files` & `git status --short`): 0 file kredensial/database/log ter-track.
- **Next Steps**: Jalankan `git push origin main` bila siap menerbitkan image terbaru ke GHCR (`ghcr.io/wawans/instabox-monitor`).

### Phase 6 — Port Publishing & Management
- **Branch**: `feat/phase-6-port-publishing`
- **Ringkasan Perubahan**:
  - `internal/instabox/` (`types.go`, `client.go`, `client_test.go`): Menambahkan `PublishPortRequest`, field `PublicPort.Token`, metode `ListMachinePorts`, `PublishPort`, dan `UnpublishPort`, serta unit test `TestClientPortPublishingAndUnpublish` (`201`/`200`/`204`/`403`/`409`/`429`).
  - `internal/poller/manager.go` & `poller_test.go`: Menambahkan `SanitizePublicPort`, `UpsertCachedPort`, `RemoveCachedPort`, serta sanitasi defensif di `pollOnce` dan `decodeSnapshot` sehingga secret `token` & `tokenUrl` tidak pernah tersimpan di cache memori maupun SQLite `account_snapshots`, plus unit test `TestPortCacheUpsertStripsTokenAndRemoveUpdatesSnapshot`.
  - `internal/api/port_handlers.go`, `router.go`, `fleet_handlers.go`, `api_test.go`: Menambahkan endpoint `GET/POST /api/accounts/{accountId}/vms/{machineId}/ports` dan `DELETE /api/accounts/{accountId}/vms/{machineId}/ports/{port}`, memperkaya `GET /api/ports` (`orgId`, `orgName`, `canWrite`, `readOnly`), validasi port `1024..65535`, reserved port `5901`/`6768`, pembatasan `tcp + private` & `rotateToken + public`, adaptif `403 missing_scope`, kebijakan **Zero-Leak** (`token`/`tokenUrl` hanya dikembalikan one-time pada respons `POST` langsung), serta integration test `TestAppPortPublishRotateUnpublishAndZeroLeak`.
  - `web/src/` (`PublishPortModal.tsx`, `PortsPage.tsx`, `VMDetailPage.tsx`, `App.tsx`, `lib/api.ts`, `types/instabox.ts`): Upgrade penuh menu **Ports (`/ports`)** dengan 4 kartu KPI, filter persisten di URL, chip akun, toggle `List | Grouped by VM`, Mobile Cards + Desktop Table, modal **Publish/Edit Port** (validasi `5901`/`6768`, kunci `Public` untuk TCP SNI, kuota `X/16`, peringatan VM offline `503`), **One-Time Private Token Reveal**, rotasi token, konfirmasi unpublish, serta pengelolaan port langsung pada tab **Ports & Details** di VM Detail.
  - Dokumentasi: Pembaruan `docs/SPEC.md`, `docs/TASKS.md`, `docs/HANDOFF.md`, `CHANGELOG.md`, `README.md`, dan `walkthrough.md`.
- **Verifikasi End-to-End**:
  - `go vet ./...` & `go test -count=1 -race ./...`: 7/7 package PASS (0 error, 0 race).
  - `pnpm --dir web typecheck && pnpm --dir web build`: `tsc --noEmit` Exit 0, Vite production build selesai dalam `3.12s`.
  - Cross-compile statis (`CGO_ENABLED=0` dengan embedded `web/dist`): `linux/amd64` (`14M` stripped) & `linux/arm64` (`13M` stripped) PASS.
  - `docker build -t instabox-monitor:local .`: Image distroless `24,991,917` bytes (~25.0 MB) PASS.
  - Container smoke test (`APP_ENV=production`): `/api/health` `200 OK`, `/` embedded SPA `<title>InstaBox Monitor — Multi-Account VM Fleet</title>`, `-healthcheck` exit `0`, serta `PROD_LOG_FILES=0` (via bind-mount `/app/logs`).
  - Audit keamanan Git (`git ls-files` & `git status --short`): 0 file kredensial/database/log ter-track.
- **Next Steps**: Jalankan `git push origin main` bila siap menerbitkan image terbaru ke GHCR (`ghcr.io/wawans/instabox-monitor`).

### Phase 5 — Multi-Arch Docker, GitHub Workflow (GHCR) & Deployment User Guide
- **Branch**: `build/phase-5-docker-ghcr-docs`
- **Ringkasan Perubahan**:
  - `Dockerfile` & `.dockerignore`: multi-stage build (`node:22-alpine` + `pnpm@12.15.0` → `golang:1.26-alpine` `CGO_ENABLED=0` cross-compile → `gcr.io/distroless/static-debian12:nonroot`, ukuran image final **24.9 MB**, built-in `HEALTHCHECK -healthcheck`, kepemilikan non-root UID `65532` pada `/data` & `/app/logs`).
  - `internal/logger/logger.go`: penyesuaian permission file log debug ke `0644` (tertemukan saat container smoke test distroless agar operator host bisa membaca `./logs/log-yyyy-mm-dd.log` tanpa `sudo`).
  - `.github/workflows/docker-publish.yml`: pipeline CI/CD penuh (Job `test` Go + Frontend → Job `build-and-publish` multi-arch `linux/amd64,linux/arm64` ke GHCR dengan kebijakan tagging `main` → `:latest`+`:sha-`, `v*.*.*` → semver+`:latest`, PR → build check tanpa push, `workflow_dispatch`).
  - `docker-compose.yml` (GHCR `ghcr.io/wawans/instabox-monitor:latest`), `docker-compose.local.yml`, `Makefile`, dan `scripts/build-multiarch.sh`.
  - `docs/DEPLOYMENT_GUIDE.md` & `README.md`: panduan pengguna lengkap deployment via Docker Image GHCR dalam Bahasa Indonesia (prasyarat `amd64`/`arm64`, GHCR login, `APP_KEY`, `APP_PASSWORD`, `APP_ENV=DEBUG`, reverse proxy SSE Nginx/Caddy, upgrade, backup/restore, troubleshooting).
- **Verifikasi End-to-End**:
  - `go vet ./...` & `go test -race ./...`: 7/7 package PASS (0 error, 0 race).
  - `pnpm --dir web typecheck && pnpm --dir web build`: PASS (0 error).
  - Cross-compile statis `linux/amd64` (13 MB) & `linux/arm64` (13 MB): PASS.
  - Docker local build (`24.9 MB`) & container smoke test:
    - Mode `production`: `/api/health` 200 OK, embedded SPA OK, `-healthcheck` exit 0, `0` file log dibuat.
    - Mode `APP_ENV=DEBUG` + `TZ=Asia/Jakarta` + `APP_PASSWORD`: `/api/fleet` unauthenticated `401`, file `log-2026-11-24.log` tercipta (`0644`) dengan timestamp `+07:00`.
  - Multi-arch `docker buildx build --platform linux/amd64,linux/arm64`: PASS (`MULTIARCH_BUILD_OK`).
  - Audit keamanan Git: 0 file kredensial/sensitif/log/db ter-commit.
- **Next Steps**: Push branch `main` ke remote GitHub `wawans/instabox-monitor` untuk menjalankan GitHub Actions publish pertama ke GHCR.

### Phase 4 — Frontend Dashboard SPA (React + TypeScript + Tailwind + Recharts)
- **Branch**: `feat/phase-4-frontend-dashboard`
- **Ringkasan Perubahan**:
  - Setup proyek `web/` dengan React 19, TypeScript, Vite 6, Tailwind CSS v4, Recharts 3, Lucide icons, dan `pnpm-workspace.yaml` (`allowBuilds` untuk `esbuild` & `@tailwindcss/oxide`).
  - `FleetPage` & `LifecycleControls`: KPI strip 4 metrik, filter multi-akun/org/state/search tersimpan di URL query params, tombol massal `Wake All (N)` mengikuti filter aktif, **daftar VM responsif dua mode** (Card view di mobile `< 768px` dengan tombol *touch-friendly* & Table sortable di tablet/desktop `>= 768px`), 1-klik Start/Resume, dialog konfirmasi Pause/Stop dengan checkbox eksplisit **Force Stop (`now=true`)**, tanpa Delete VM.
  - `VMDetailPage` & `MetricCharts`: 5 tab (Metrics `15m`/`1h`/`6h`/`24h` untuk CPU/RAM/Network/Disk I/O/GPU, Disk & Storage, Processes, Serial Console Logs & 20 Operations, Ports & Metadata/Diagnostics) + live Operation Tracker via SSE.
  - `PortsPage`, `AccountsPage`, `AccountModal`, `LoginPage`: agregasi Public Ports, manajemen akun lengkap dengan modal 2 tab (`Single` & `Bulk Import` CSV/JSON/YAML + file upload + preview + validasi `/v1/me` + laporan *partial success*), serta banner pemulihan cepat untuk `Auto-Disabled (401)` dan `Key Error`.
- **Verifikasi**: `pnpm --dir web typecheck` (0 error), `pnpm --dir web build` (3.44s), `go vet ./...`, `go test -race ./...` (7/7 package PASS), dan single binary embedded SPA (`CGO_ENABLED=0`) berukuran 19 MB.
- **Next Steps**: Multi-stage `Dockerfile` (`linux/amd64` & `linux/arm64`, distroless non-root), GitHub Actions Workflow GHCR (`ghcr.io/wawans/instabox-monitor`), `docker-compose.yml`, dan `docs/DEPLOYMENT_GUIDE.md` pada branch `build/phase-5-docker-ghcr-docs`.

### Phase 3 — Background Poller, SSE Broker, Auth (`APP_PASSWORD`) & REST API
- **Branch**: `feat/phase-3-poller-sse-api`
- **Ringkasan Perubahan**:
  - `internal/poller/`: goroutine poller terisolasi per akun dengan `defer recover()`, startup freshness check (`account_snapshots`), tiered metrics polling (`METRICS_POLL_INTERVAL_SECONDS`), pemulihan `key_error` non-blocking, auto-disable otomatis setelah `ACCOUNT_MAX_AUTH_FAILURES` kali `401`, backoff `429`/`5xx`, operation long-poll tracker, dan SSE broker.
  - `internal/api/`: optional session auth (`APP_PASSWORD`/`APP_USERNAME`, rate-limited login, `HttpOnly` cookie), CRUD akun Zero-Export, `POST /api/accounts/bulk` (*partial success* CSV/JSON/YAML + `api_key_hash` skip duplicates + validasi paralel `/v1/me`), `GET /api/fleet`, `POST /api/fleet/wake-all`, `GET /api/ports`, `GET /api/activity`, `GET /api/events` (SSE), serta detail VM & kontrol lifecycle adaptif (Force Stop `?now=true`, auto-detect `403 missing_scope`).
  - `cmd/server/main.go` & `internal/webui/embed.go`: entrypoint binary dengan embedded `time/tzdata`, `-healthcheck` flag, graceful shutdown, dan embedded SPA handler.
- **Verifikasi**: `go vet ./...`, `go test -v -race ./...` (seluruh 7 package PASS), dan `CGO_ENABLED=0 go build ./cmd/server` PASS.
- **Next Steps**: Implementasi Frontend React 19 + TypeScript + Tailwind CSS v4 + Recharts SPA pada branch `feat/phase-4-frontend-dashboard`.

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
