# InstaBox Monitor

Dashboard monitoring VM (*sandboxes*) [instabox.sh](https://instabox.sh) dengan dukungan **multi-akun** melalui REST API resmi InstaBox, dikemas sebagai single binary Go + embedded React SPA dalam Docker image multi-arch (`linux/amd64` & `linux/arm64`) yang dipublikasikan ke GHCR (`ghcr.io/wawans/instabox-monitor`).

> Status: Dalam pengembangan mengikuti alur Spec-Driven Development. Lihat [docs/SPEC.md](docs/SPEC.md), [docs/TASKS.md](docs/TASKS.md), dan [docs/HANDOFF.md](docs/HANDOFF.md).

## Fitur Utama
- **Multi-Akun Terisolasi**: Tiap akun berjalan pada Background Poller terpisah dengan startup freshness check, tiered metrics polling, backoff `429`/`5xx`, serta auto-disable otomatis setelah *N* kali error `401` berturut-turut.
- **Monitoring Real-Time & Historis**: Ringkasan fleet lintas akun (Card di mobile, Tabel di tablet/desktop), update SSE real-time, grafik metrik 30-detik hingga 24 jam (CPU, RAM, Network, Disk I/O, GPU), kapasitas disk `/data` & `/`, daftar proses, serial console log + 20 operasi terakhir, serta agregasi Public Ports.
- **Kontrol Lifecycle Aman**: 1-klik Start/Resume, Pause/Stop (dengan opsi Force Stop eksplisit, tanpa Delete VM), tombol massal `Wake All` mengikuti filter aktif, serta otomatis adaptif untuk API key read-only.
- **Manajemen Akun Hybrid & Aman**: Tambah akun Single & Bulk Import (CSV/JSON/YAML) dari UI + seeding ENV/YAML (`ACCOUNTS_SEED_MODE=sync|bootstrap`), enkripsi AES-256-GCM (`APP_KEY`), deteksi duplikat via `HMAC-SHA256`, kebijakan Zero-Export write-only, dan proteksi login opsional (`APP_PASSWORD`).
- **Logging Kondisional**: File log harian `logs/log-yyyy-mm-dd.log` (mengikuti `TZ`, auto-prune 7 hari) hanya aktif ketika `APP_ENV=DEBUG`.

## Dokumentasi
- [Spesifikasi Teknis (SPEC)](docs/SPEC.md)
- [Milestone & Task Tracker](docs/TASKS.md)
- [Handoff Log](docs/HANDOFF.md)
- [Changelog](CHANGELOG.md)
