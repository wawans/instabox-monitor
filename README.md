# InstaBox Monitor

Dashboard monitoring VM (*sandboxes*) [instabox.sh](https://instabox.sh) dengan dukungan **multi-akun** melalui REST API resmi InstaBox (`https://api.instabox.sh`), dikemas sebagai single binary Go + embedded React SPA dalam Docker image ringan (~20 MB) untuk arsitektur **`linux/amd64`** dan **`linux/arm64`** yang dipublikasikan otomatis ke **GHCR (`ghcr.io/wawans/instabox-monitor`)**.

## Fitur Utama
- **Multi-Akun Terisolasi**: Tiap akun berjalan pada Background Poller terpisah (`defer recover()`), dilengkapi *startup freshness check* dari snapshot SQLite, *tiered metrics polling* (`15s` state/ports, `30s` live CPU/RAM/Disk), backoff `429`/`5xx`, pemulihan `APP_KEY` non-blocking (`key_error`), serta **auto-disable otomatis** setelah *N* kali error `401` berturut-turut (`ACCOUNT_MAX_AUTH_FAILURES`).
- **Monitoring Real-Time & Historis**:
  - **Fleet Overview**: KPI summary, filter multi-akun/org/state/search, update real-time via **SSE**, **tampilan Card di mobile (`< 768px`)** & **Tabel sortable di tablet/desktop (`>= 768px`)**.
  - **VM Detail Inspector (5 Tab)**: grafik metrik 30-detik hingga 24 jam (CPU, RAM, Network, Disk I/O, GPU), kapasitas disk `/data` & `/` beserta warning level, daftar proses (`live`/`last-seen`), serial console log + 20 operasi terakhir, serta ports & diagnostics (`lastOom`, `lastError`, `abuseLock`).
  - **Public Ports**: agregasi seluruh port HTTP/TCP lintas akun & VM.
- **Kontrol Lifecycle Aman**: 1-klik **Start** & **Resume/Wake**, konfirmasi **Pause** & **Stop** (termasuk checkbox eksplisit **Force Stop `now=true`**; tanpa Delete VM), tombol massal **`Wake All (N)`** mengikuti filter aktif, dan otomatis adaptif untuk API key read-only.
- **Manajemen Akun Hybrid & Zero-Export**: Tambah akun **Single** maupun **Bulk Import** (CSV/plain-text/JSON/YAML + file upload + *partial success*) dari UI, seeding ENV/YAML (`ACCOUNTS_SEED_MODE=sync|bootstrap`), enkripsi **AES-256-GCM** (`APP_KEY`), deteksi duplikat via `HMAC-SHA256`, kebijakan Zero-Export write-only, serta proteksi login opsional (`APP_PASSWORD`).
- **Conditional Debug Logging**: File log harian `logs/log-yyyy-mm-dd.log` (mengikuti `TZ`, auto-prune 7 hari) **hanya** dibuat dan ditulis ketika `APP_ENV=DEBUG`.

## Quick Start Deployment (Docker GHCR — `amd64` & `arm64`)

Lihat panduan lengkap langkah demi langkah di **[docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)**.

```bash
cp .env.example .env
# Set APP_KEY (openssl rand -hex 32) dan opsional APP_PASSWORD di .env
docker compose up -d
```

Akses dashboard di `http://localhost:8080`.

## Pengembangan Lokal & Build

```bash
# Jalankan seluruh pengujian (Go vet + race tests + frontend typecheck)
make test

# Build binary penuh dengan embedded React SPA
make build

# Cross-compile static binary linux/amd64 & linux/arm64
make build-all

# Build image Docker lokal
make docker-local

# Build multi-arch Docker image (linux/amd64, linux/arm64) via buildx
make docker-multiarch
```

## Dokumentasi Proyek
- **[Panduan Pengguna Deployment GHCR](docs/DEPLOYMENT_GUIDE.md)**
- [Spesifikasi Teknis (SPEC)](docs/SPEC.md)
- [Milestone & Task Tracker](docs/TASKS.md)
- [Handoff Log](docs/HANDOFF.md)
- [Changelog](CHANGELOG.md)
