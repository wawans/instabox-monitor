# Project Handoff Log

Dokumen handoff hidup yang diperbarui setiap selesai 1 fase/task sebelum merge ke `main`.

---

## Status Terkini
- **Fase Terakhir Selesai**: Phase 0 — Bootstrap Repositori, `.gitignore` & Dokumen SDD (merged ke `main`)
- **Branch Aktif**: `main`
- **Target Berikutnya**: Phase 1 (`feat/phase-1-core-store-crypto-log`)

---

## Riwayat Fase

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
