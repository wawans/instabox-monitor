# Changelog

Semua perubahan penting pada proyek **InstaBox Monitor** dicatat dalam file ini mengikuti format [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) dan Conventional Commits.

## [Unreleased]

### Phase 5 — Multi-Arch Docker, GitHub Workflow (GHCR) & Deployment User Guide
- Menambahkan multi-stage `Dockerfile` (`linux/amd64` & `linux/arm64`, distroless non-root ~24.9 MB, built-in `-healthcheck`) dan `.dockerignore`.
- Menambahkan GitHub Actions workflow `.github/workflows/docker-publish.yml` untuk test otomatis serta build & publish image multi-arch ke `ghcr.io/wawans/instabox-monitor`.
- Menambahkan `docker-compose.yml` (GHCR), `docker-compose.local.yml`, `Makefile`, dan `scripts/build-multiarch.sh`.
- Menambahkan panduan pengguna deployment GHCR lengkap di `docs/DEPLOYMENT_GUIDE.md` serta pembaruan final `README.md`.
- Menyesuaikan permission file log debug ke `0644` agar mudah dibaca dari host saat bind-mount `/app/logs` di container distroless non-root.

### Phase 4 — Frontend Dashboard SPA (React + Tailwind v4 + Recharts)
- Menambahkan SPA React 19 + TypeScript (English UI, default Dark Mode + toggle Light Mode) ter-embed ke binary Go.
- Menambahkan halaman Fleet Overview dengan **Card view di mobile** & **Tabel sortable di tablet/desktop**, tombol lifecycle 1-klik Start/Resume, modal Pause/Stop (dengan opsi Force Stop), serta tombol massal `Wake All (N)` mengikuti filter aktif.
- Menambahkan halaman VM Detail 5 tab (Metrics `15m`–`24h` CPU/RAM/Net/Disk I/O/GPU, Disk, Processes, Console Logs & Operations, Ports & Diagnostics), halaman Public Ports, halaman Login (`APP_PASSWORD`), serta halaman Accounts dengan modal **Single & Bulk Import** (CSV/JSON/YAML + upload) dan banner pemulihan `Auto-Disabled (401)` / `Key Error`.

### Phase 3 — Background Poller, SSE, Auth & Backend REST API
- Menambahkan isolated per-account Background Poller dengan startup freshness check, tiered metrics polling, non-blocking `key_error`, auto-disable setelah *N* kali `401`, dan SSE broker (`/api/events`).
- Menambahkan optional session auth (`APP_PASSWORD`/`APP_USERNAME`) dengan rate limiter login dan cookie `HttpOnly`.
- Menambahkan REST API lengkap termasuk `POST /api/accounts/bulk` (*partial success*, `api_key_hash` duplicate skip), `POST /api/fleet/wake-all`, kontrol lifecycle adaptif + Force Stop, dan entrypoint `cmd/server` dengan `-healthcheck` & embedded `time/tzdata`.

### Phase 2 — InstaBox REST API Client
- Menambahkan tipe data OpenAPI InstaBox lengkap (`internal/instabox/types.go`) dan structured `APIError`.
- Menambahkan HTTP client `X-API-Key` (`internal/instabox/client.go`) dengan auto-pagination cursor, `Idempotency-Key`, Force Stop `?now=true`, dan long-poll `GetOperation`.
- Menambahkan mock test suite lengkap berbasis `httptest.NewServer`.

### Phase 1 — Core Infrastructure, Conditional Logger, Crypto & SQLite Store
- Menambahkan parser konfigurasi env (`APP_KEY`, `APP_PASSWORD`, `APP_ENV`, `POLL_INTERVAL_SECONDS`, `METRICS_POLL_INTERVAL_SECONDS`, `ACCOUNT_MAX_AUTH_FAILURES`, `ACCOUNTS_SEED_MODE`).
- Menambahkan conditional daily file logger `logs/log-yyyy-mm-dd.log` (khusus `APP_ENV=DEBUG`, TZ-aware, auto-prune 7 hari).
- Menambahkan modul enkripsi AES-256-GCM (`APP_KEY` + `.master.key` fallback) dan keyed `HMAC-SHA256` hash (`api_key_hash`) untuk deteksi duplikat Zero-Export.
- Menambahkan persistence SQLite pure-Go (`modernc.org/sqlite` WAL) untuk `accounts`, `account_snapshots`, `sessions`, dan `activity_events`.
- Menambahkan hybrid seeder (`INSTABOX_ACCOUNTS_JSON` / `INSTABOX_ACCOUNTS_FILE`) dengan mode `sync` & `bootstrap` serta proteksi akun UI.

### Phase 0 — Bootstrap & Spec-Driven Development
- Inisialisasi repositori Git dengan konvensi branch per fase dan `.gitignore` ketat untuk kredensial, database, dan file log.
- Menyusun spesifikasi arsitektur lengkap (`docs/SPEC.md`), milestone tracker (`docs/TASKS.md`), dan dokumen handoff (`docs/HANDOFF.md`).
- Menambahkan bootstrap `go.mod`, `.env.example`, dan `accounts.example.yaml`.
