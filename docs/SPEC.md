# Spesifikasi Teknis: InstaBox Multi-Account VM Monitoring Dashboard

Dokumen ini adalah *source of truth* (Spec-Driven Development) untuk seluruh arsitektur, kontrak API, skema penyimpanan, keamanan, dan pipeline deployment **InstaBox Monitor** (`instabox-monitor`).

## 1. Ringkasan & Tujuan
Dashboard terpusat untuk memantau dan mengelola VM (*sandboxes*) pada layanan [instabox.sh](https://instabox.sh) secara **multi-akun** melalui REST API resmi (`https://api.instabox.sh`, mengacu pada OpenAPI `/v1/openapi.json`). Aplikasi dikemas sebagai **single binary Go + embedded React SPA** dalam Docker image ringan (~20 MB) untuk arsitektur **`linux/amd64`** dan **`linux/arm64`**, dibangun serta dipublikasikan otomatis ke **GHCR (`ghcr.io/wawans/instabox-monitor`)**.

## 2. Arsitektur & Stack Teknologi
- **Backend**: Go (`module instabox-monitor`, `CGO_ENABLED=0`), standard `net/http` (Go 1.22+ ServeMux), `log/slog`, embedded `time/tzdata`, dan embedded SPA (`//go:embed`).
- **Database**: Pure-Go SQLite (`modernc.org/sqlite`) dalam mode WAL (`monitor.db` pada `DATA_DIR`), sehingga cross-compile `linux/amd64` & `linux/arm64` berjalan native tanpa CGO maupun QEMU.
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4 + Recharts + Lucide Icons (antarmuka Bahasa Inggris, Dark Mode default + toggle Light Mode).
- **Container Runtime**: Multi-stage `Dockerfile` berbasis `gcr.io/distroless/static-debian12:nonroot` (UID `65532`) dengan flag `-healthcheck` internal.

## 3. Spesifikasi Environment Variables

| Variable | Default | Deskripsi |
| :--- | :--- | :--- |
| `PORT` | `8080` | Port HTTP server |
| `APP_ENV` | `production` | `production` (stdout INFO saja) atau `DEBUG` (stdout + `logs/log-yyyy-mm-dd.log`) |
| `LOG_DIR` | `logs` | Direktori file log harian saat `APP_ENV=DEBUG` |
| `DATA_DIR` | `/data` (atau `./data` bila lokal) | Direktori `monitor.db` & fallback `.master.key` |
| `APP_KEY` | *(auto-generate `.master.key`)* | Kunci master enkripsi AES-256-GCM & HMAC-SHA256 `api_key_hash` |
| `APP_USERNAME` | `admin` | Username login dashboard (aktif bila `APP_PASSWORD` diset) |
| `APP_PASSWORD` | *(kosong)* | Password login dashboard opsional |
| `COOKIE_SECURE` | `auto` | Flag `Secure` cookie sesi (`auto`, `true`, `false`) |
| `POLL_INTERVAL_SECONDS` | `15` | Interval polling `/v1/machines` & `/v1/ports` (min `5`) sekaligus ambang *staleness* startup |
| `METRICS_POLL_INTERVAL_SECONDS` | `30` | Interval *tiered polling* live CPU/RAM/Disk tabel Fleet (`0` = nonaktif) |
| `ACCOUNT_MAX_AUTH_FAILURES` | `3` | Batas error `401` berturut-turut sebelum akun auto-disabled (`0` = nonaktif) |
| `INSTABOX_ACCOUNTS_JSON` | *(kosong)* | JSON array akun untuk seeding startup |
| `INSTABOX_ACCOUNTS_FILE` | *(kosong)* | Path file YAML/JSON akun untuk seeding startup |
| `ACCOUNTS_SEED_MODE` | `sync` | `sync` (ENV/File update akun `source='seed'`) atau `bootstrap` (`INSERT IF NOT EXISTS`) |
| `TZ` | `UTC` | Timezone container (embedded `time/tzdata`) untuk rotasi nama file log harian |

## 4. Logging Kondisional (`APP_ENV=DEBUG`)
- Saat `APP_ENV` **bukan** `DEBUG` (default `production`): `slog` level `INFO` ke `os.Stdout` saja; **tidak** membuat folder `logs/` maupun file `.log`.
- Saat `APP_ENV=DEBUG` (case-insensitive): `slog` level `DEBUG` ditulis serentak ke `os.Stdout` **dan** `<LOG_DIR>/log-YYYY-MM-DD.log` mengikuti timezone `TZ`.
- Rotasi harian otomatis saat tanggal berubah, disertai **auto-prune otomatis file `log-*.log` lebih tua dari 7 hari**.

## 5. Keamanan Kredensial, Enkripsi & Kebijakan Zero-Export
- **Enkripsi AES-256-GCM**: Setiap API key dienkripsi dengan random 12-byte nonce menggunakan `APP_KEY` (derived 32-byte key).
- **Duplicate Hash (`api_key_hash`)**: Dihitung deterministik dengan `HMAC-SHA256(APP_KEY, apiKey)` (hex) untuk deteksi duplikat akun (termasuk Bulk Import) & deteksi rotasi key tanpa pernah menyimpan/mengekspos plaintext.
- **Zero-Export (Write-Only)**: API key plaintext **tidak pernah** dikirim kembali ke frontend atau diekspos di endpoint API mana pun; hanya preview tersamar `key_hint` (`ibk_••••xxxx`).
- **Pemulihan `APP_KEY` Non-Blocking (`key_error`)**: Jika dekripsi gagal saat startup/poll akibat perbedaan `APP_KEY`, server tetap menyala, akun terkait ditandai `last_sync_status='key_error'` (poller dijeda, snapshot terakhir aman), sementara akun lain tetap berjalan normal.
- **Seeding Hybrid (`source: 'seed' | 'ui'` + `ACCOUNTS_SEED_MODE`)**:
  - Akun `source='ui'` tidak pernah ditimpa/dihapus seeder.
  - `ACCOUNTS_SEED_MODE=sync`: insert baru & update akun `source='seed'`; re-encrypt otomatis jika ciphertext lama `key_error`; untuk akun `auto_disabled`, hanya reset & re-enable jika `api_key_hash` benar-benar berubah.
  - `ACCOUNTS_SEED_MODE=bootstrap`: `INSERT IF NOT EXISTS` saja (DB menang setelah seed pertama).
- **Optional Session Auth**: Aktif hanya bila `APP_PASSWORD` diisi; verifikasi constant-time, IP rate-limit pada `/api/auth/login`, sesi opaque 32-byte disimpan sebagai hash SHA-256 di SQLite (`HttpOnly; SameSite=Lax`).

## 6. Skema Database SQLite (`monitor.db`)
1. `accounts`: `id`, `slug` (UNIQUE), `name`, `base_url`, `api_key_enc`, `api_key_hash`, `key_hint`, `enabled`, `read_only`, `write_capable`, `source`, `user_login`, `user_email`, `orgs_json`, `last_sync_at`, `last_sync_status`, `last_error`, `consecutive_auth_failures`, `disabled_reason`, `created_at`, `updated_at`.
2. `account_snapshots`: `account_id` (PK, FK cascade), `machines_json`, `ports_json`, `metrics_json`, `fetched_at`, `metrics_fetched_at`.
3. `sessions`: `token_hash` (PK), `username`, `expires_at`, `created_at`.
4. `activity_events`: `id` (PK), `account_id`, `machine_id`, `machine_name`, `event_type`, `detail`, `created_at`.

## 7. Background Poller: Isolasi, Startup Freshness, Tiered Metrics & Auto-Disable
- **Isolasi Penuh per Akun**: Tiap akun aktif berjalan di goroutine terpisah dengan `defer recover()`, context cancel terpisah, serta backoff sendiri.
- **Startup Freshness Check**: Saat startup, snapshot terakhir dimuat dari `account_snapshots`. Untuk tiap akun aktif:
  - Jika belum ada snapshot atau `time.Since(fetched_at) >= POLL_INTERVAL_SECONDS` → langsung menjalankan **immediate poll**.
  - Jika masih segar → langsung menyajikan cache SQLite dan menjadwalkan poll berikutnya setelah sisa waktu (`pollInterval - age`).
- **Tiered Metrics Polling**: `/v1/machines` & `/v1/ports` di-poll tiap `POLL_INTERVAL_SECONDS` (15s); `/v1/machines/{id}/metrics?since=2m` untuk VM running di-poll tiap `METRICS_POLL_INTERVAL_SECONDS` (30s, `0` = nonaktif) dengan bounded worker concurrency (maks 4 paralel, cap 25 VM per siklus).
- **Penanganan Error & Auto-Disable `401`**:
  - Sukses → reset `consecutive_auth_failures = 0`, `disabled_reason = ""`.
  - `401` (`invalid_key`, `expired_key`, `revoked_key`, `missing_key`) → increment `consecutive_auth_failures`; saat mencapai `ACCOUNT_MAX_AUTH_FAILURES` (default 3) → `enabled = 0`, `last_sync_status = "auto_disabled"`, simpan `disabled_reason`, catat `activity_events`, hentikan goroutine poller akun tsb, broadcast SSE.
  - `429 rate_limited` → cooldown mengikuti `retryAfterSeconds` (tidak menaikkan counter `401`).
  - Timeout / `5xx` → exponential backoff capped 5 menit, pertahankan snapshot lama sebagai stale cache (tidak menaikkan counter `401`).
  - `403 missing_scope` pada aksi lifecycle → otomatis tandai `write_capable = 0` tanpa mengganggu monitoring.

## 8. Pemetaan Endpoint InstaBox & Kontrak API Internal

### InstaBox REST API (`https://api.instabox.sh`)
- `GET /v1/me`, `GET /v1/orgs`, `GET /v1/usage`
- `GET /v1/machines` (auto cursor pagination), `GET /v1/machines/{id}`
- `GET /v1/machines/{id}/metrics?since=...` (30s samples hingga 24h)
- `GET /v1/machines/{id}/disk`, `GET /v1/machines/{id}/processes`, `GET /v1/machines/{id}/logs?tail=...&after=...`
- `GET /v1/ports`
- `POST /v1/machines/{id}/{start|stop|suspend|resume}` (wajib `Idempotency-Key`; `stop` mendukung `?now=true` untuk Force Stop; **Delete VM dikecualikan**)
- `GET /v1/operations/{id}?wait=25`

### Internal Backend REST & SSE API
- `GET /api/health` (publik)
- `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout`
- `GET /api/accounts`, `POST /api/accounts`, `POST /api/accounts/bulk` (*partial success*, `api_key_hash` skip duplicates, validasi `/v1/me` opsional), `POST /api/accounts/test`, `PATCH /api/accounts/{id}`, `DELETE /api/accounts/{id}`, `POST /api/accounts/{id}/sync`
- `GET /api/fleet`, `POST /api/fleet/wake-all` (mengikuti filter aktif, tanpa Pause/Stop All), `GET /api/ports`, `GET /api/activity`, `GET /api/events` (SSE)
- `GET /api/accounts/{accountId}/vms/{machineId}/{metrics,disk,processes,logs}`
- `POST /api/accounts/{accountId}/vms/{machineId}/actions/{start|stop|suspend|resume}` (body opsional `{"force": true}` untuk `stop`)
- `GET /api/accounts/{accountId}/operations/{opId}`

## 9. Spesifikasi Web UI
- Bahasa Inggris standar ops, Dark Mode default + toggle Light Mode.
- **Fleet (`/`)**: KPI strip, chip akun + filter org/state/search, tombol **`Wake All (N)`** mengikuti filter aktif, **daftar VM responsif**: **Card view di mobile (`< 768px`)** dengan tombol *touch-friendly* dan **Table view sortable di tablet/desktop (`>= 768px`)**. Kontrol lifecycle 1-klik langsung untuk Start/Resume, modal konfirmasi untuk Pause/Stop (dengan checkbox eksplisit **Force Stop**), tanpa Delete VM.
- **VM Detail (`/accounts/:accountId/vms/:machineId`)**: 5 tab (Metrics `15m`/`1h`/`6h`/`24h`, Disk & Storage, Processes, Console Logs & Operations, Ports & Details) + live Operation Tracker.
- **Ports (`/ports`)**: agregasi public/private ports lintas akun.
- **Accounts (`/accounts`)**: CRUD akun, modal **Add Account** 2 tab (**Single** | **Bulk Import** CSV/plain-text/JSON/YAML + file upload + preview + validasi opsional), kuota org, badge `Config`/`UI`, `Auto-Disabled (401)`, dan `Key Error`.
- **Login (`/login`)**: tampil otomatis saat `APP_PASSWORD` aktif.

## 10. Spesifikasi Docker Multi-Arch & GHCR CI/CD
- Target arsitektur: `linux/amd64` dan `linux/arm64` via `BUILDPLATFORM` cross-compilation (`CGO_ENABLED=0`).
- Workflow `.github/workflows/docker-publish.yml`:
  - Push ke `main` → publish `:latest` & `:sha-<short>` ke `ghcr.io/wawans/instabox-monitor`.
  - Push tag `v*.*.*` → publish `:v1.2.3`, `:1.2`, & `:latest`.
  - Pull Request → jalankan test & multi-arch build check tanpa push.
  - `workflow_dispatch` → trigger manual.
