# Changelog

Semua perubahan penting pada proyek **InstaBox Monitor** dicatat dalam file ini mengikuti format [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) dan Conventional Commits.

## [Unreleased]

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
