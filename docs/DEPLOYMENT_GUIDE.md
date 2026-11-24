# Panduan Pengguna: Deployment InstaBox Monitor via Docker Image GHCR

Panduan ini menjelaskan langkah demi langkah cara men-deploy **InstaBox Monitor** menggunakan Docker Image multi-arsitektur (**`linux/amd64`** dan **`linux/arm64`**) yang dibangun dan dipublikasikan otomatis oleh GitHub Actions ke **GitHub Container Registry (GHCR)**.

---

## 1. Prasyarat
- Server Linux atau macOS berarsitektur **`amd64` (x86_64)** maupun **`arm64` (Raspberry Pi 4/5, Oracle Cloud ARM, Apple Silicon, AWS Graviton)**.
- **Docker Engine** (`>= 24.x`) dan **Docker Compose v2** (`docker compose version`).
- Minimal 1 API Key InstaBox (`ibk_...`) yang dibuat dari [dashboard.instabox.sh/dashboard/api-keys](https://dashboard.instabox.sh/dashboard/api-keys) atau CLI `instabox keys create`:
  - Scope `machines:read` cukup untuk monitoring penuh.
  - Scope `machines:write` dibutuhkan jika ingin mengaktifkan tombol Start, Stop (termasuk Force Stop), Pause, Resume, dan Wake All.

---

## 2. Memastikan Image Sudah Dipublish di GHCR

Workflow GitHub Actions [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) otomatis menjalankan seluruh test lalu membangun & mempublikasikan image multi-arch ke:

```text
ghcr.io/wawans/instabox-monitor:latest
```

### Kebijakan Tag Otomatis
| Event GitHub | Tag GHCR yang Dihasilkan |
| :--- | :--- |
| Push ke branch `main` | `:latest` dan `:sha-<commit>` |
| Push tag rilis semver (mis. `v1.0.0`) | `:1.0.0`, `:1.0`, `:latest`, dan `:sha-<commit>` |
| Trigger manual (`workflow_dispatch`) | `:latest` dan `:sha-<commit>` |
| Pull Request | Hanya menjalankan test & verifikasi build (tidak push ke GHCR) |

### Login ke GHCR (Jika Package Bersifat Private)
Jika package GHCR Anda bersifat **public**, lewati langkah ini. Jika **private**, buat Personal Access Token (classic) dengan scope `read:packages`, lalu login di server target:

```bash
echo "ghp_your_token_here" | docker login ghcr.io -u wawans --password-stdin
```

Tarik image untuk memastikan arsitektur host terdeteksi otomatis:
```bash
docker pull ghcr.io/wawans/instabox-monitor:latest
```

---

## 3. Persiapan Folder Deployment & Konfigurasi (`.env`)

Buat direktori deployment di server Anda:

```bash
mkdir -p ~/instabox-monitor
cd ~/instabox-monitor
```

### 3.1 Generate `APP_KEY` yang Aman
`APP_KEY` digunakan untuk mengenkripsi seluruh API Key InstaBox di SQLite (**AES-256-GCM**) dan menghitung hash duplikat (**HMAC-SHA256**). **Simpan nilai ini di tempat aman**—jika `APP_KEY` berubah, akun yang tersimpan sebelumnya akan berstatus `Key Error` sampai API key dimasukkan ulang atau `APP_KEY` asli dikembalikan.

```bash
openssl rand -hex 32
```

### 3.2 Buat File `.env`
Buat file `.env` (jangan pernah commit file ini ke Git):

```env
# Image GHCR (default: latest; bisa dipin ke versi semver mis. :1.0.0)
IMAGE=ghcr.io/wawans/instabox-monitor:latest

# Port akses web dashboard
PORT=8080

# Mode aplikasi: production (default, stdout saja) atau DEBUG (tulis ke logs/log-yyyy-mm-dd.log)
APP_ENV=production

# Timezone untuk nama file log harian (didukung penuh di distroless)
TZ=Asia/Jakarta

# WAJIB diset: hasil `openssl rand -hex 32`
APP_KEY=ganti_dengan_hasil_openssl_rand_hex_32

# Proteksi login dashboard opsional (kosongkan APP_PASSWORD jika tidak perlu login)
APP_USERNAME=admin
APP_PASSWORD=ganti_dengan_password_kuat

# Flag Secure cookie sesi: auto (default, mengikuti X-Forwarded-Proto), true, atau false
COOKIE_SECURE=auto

# Interval polling /v1/machines & /v1/ports (detik, min 5)
POLL_INTERVAL_SECONDS=15

# Interval tiered polling live CPU/RAM/Disk tabel Fleet (detik, default 30, 0 = nonaktif)
METRICS_POLL_INTERVAL_SECONDS=30

# Auto-disable akun setelah N kali error 401 berturut-turut (default 3, 0 = nonaktif)
ACCOUNT_MAX_AUTH_FAILURES=3

# Mode seeding ENV/File: sync (default) atau bootstrap
ACCOUNTS_SEED_MODE=sync
```

### 3.3 (Opsional) Siapkan Seeding Multi-Akun `accounts.yaml`
Anda dapat menambahkan akun langsung lewat UI (Single maupun **Bulk Import** CSV/JSON/YAML), **atau** mem-bootstrap akun otomatis lewat file `accounts.yaml`:

```yaml
accounts:
  - slug: prod-workspace
    name: Prod Workspace
    apiKey: ibk_isi_api_key_prod
    readOnly: false
    enabled: true

  - slug: staging-ro
    name: Staging Read-Only
    apiKey: ibk_isi_api_key_staging
    readOnly: true
    enabled: true
```

Lalu aktifkan `INSTABOX_ACCOUNTS_FILE=/config/accounts.yaml` di `.env` dan uncomment baris volume `./accounts.yaml:/config/accounts.yaml:ro` pada `docker-compose.yml`.

---

## 4. Deploy dengan Docker Compose (Direkomendasikan)

Salin `docker-compose.yml` ke `~/instabox-monitor/docker-compose.yml`:

```yaml
services:
  instabox-monitor:
    image: ${IMAGE:-ghcr.io/wawans/instabox-monitor:latest}
    container_name: instabox-monitor
    restart: unless-stopped
    ports:
      - "${PORT:-8080}:8080"
    environment:
      PORT: "8080"
      APP_ENV: ${APP_ENV:-production}
      TZ: ${TZ:-UTC}
      DATA_DIR: /data
      LOG_DIR: /app/logs
      APP_KEY: ${APP_KEY:-}
      APP_USERNAME: ${APP_USERNAME:-admin}
      APP_PASSWORD: ${APP_PASSWORD:-}
      COOKIE_SECURE: ${COOKIE_SECURE:-auto}
      POLL_INTERVAL_SECONDS: ${POLL_INTERVAL_SECONDS:-15}
      METRICS_POLL_INTERVAL_SECONDS: ${METRICS_POLL_INTERVAL_SECONDS:-30}
      ACCOUNT_MAX_AUTH_FAILURES: ${ACCOUNT_MAX_AUTH_FAILURES:-3}
      ACCOUNTS_SEED_MODE: ${ACCOUNTS_SEED_MODE:-sync}
      INSTABOX_ACCOUNTS_JSON: ${INSTABOX_ACCOUNTS_JSON:-}
      INSTABOX_ACCOUNTS_FILE: ${INSTABOX_ACCOUNTS_FILE:-}
    volumes:
      - instabox_monitor_data:/data
      # Uncomment jika ingin menyimpan file log debug di host saat APP_ENV=DEBUG:
      # - ./logs:/app/logs
      # Uncomment jika memakai seeding dari file YAML/JSON:
      # - ./accounts.yaml:/config/accounts.yaml:ro
    healthcheck:
      test: ["CMD", "/app/instabox-monitor", "-healthcheck"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  instabox_monitor_data:
```

Jalankan container:
```bash
docker compose up -d
```

### Alternatif: Deploy Cepat dengan `docker run`
```bash
docker volume create instabox_monitor_data

docker run -d \
  --name instabox-monitor \
  --restart unless-stopped \
  -p 8080:8080 \
  -e APP_ENV=production \
  -e TZ=Asia/Jakarta \
  -e APP_KEY="ganti_dengan_hasil_openssl_rand_hex_32" \
  -e APP_PASSWORD="ganti_dengan_password_kuat" \
  -v instabox_monitor_data:/data \
  ghcr.io/wawans/instabox-monitor:latest
```

---

## 5. Verifikasi Deployment

1. **Cek status & healthcheck container**:
   ```bash
   docker compose ps
   curl -fsS http://127.0.0.1:8080/api/health
   ```
   Respons normal:
   ```json
   {"accountsHealthy":0,"accountsTotal":0,"appEnv":"production","status":"ok","uptimeSeconds":5,"version":"..."}
   ```
2. **Cek arsitektur image yang berjalan** (`amd64` atau `arm64`):
   ```bash
   docker inspect instabox-monitor --format '{{.Architecture}}'
   ```
3. **Buka dashboard di browser**: `http://<ip-server>:8080`.
   - Jika `APP_PASSWORD` diisi, Anda akan diminta login terlebih dahulu (`APP_USERNAME` / `APP_PASSWORD`).
   - Buka menu **Accounts → Add / Bulk Import** untuk menambahkan satu atau banyak akun InstaBox sekaligus.

---

## 6. Mengaktifkan Mode `APP_ENV=DEBUG` & Membaca File Log Harian

Secara default (`APP_ENV=production`), aplikasi hanya menulis log level `INFO` ke `stdout` (`docker compose logs -f`) dan **tidak** membuat file log di disk.

Untuk mengaktifkan penyimpanan log ke `logs/log-yyyy-mm-dd.log` (dengan rotasi harian mengikuti `TZ` dan **auto-prune otomatis 7 hari**):

1. Buat direktori `logs` di host dan berikan izin tulis untuk UID non-root `65532` (distroless):
   ```bash
   mkdir -p ./logs
   sudo chown -R 65532:65532 ./logs
   ```
2. Uncomment baris `- ./logs:/app/logs` di `docker-compose.yml`.
3. Ubah `.env`:
   ```env
   APP_ENV=DEBUG
   ```
4. Recreate container:
   ```bash
   docker compose up -d
   ls -la ./logs/
   tail -f ./logs/log-$(date +%Y-%m-%d).log
   ```

---

## 7. Reverse Proxy (Nginx / Caddy) dengan Dukungan SSE

Dashboard menggunakan **Server-Sent Events (`GET /api/events`)** untuk update real-time. Pastikan reverse proxy tidak me-buffer stream SSE:

### Contoh Nginx
```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Wajib agar /api/events (SSE) tidak tertahan buffering
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}
```

### Contoh Caddy
```caddy
monitor.domainanda.com {
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
    }
}
```

---

## 8. Upgrade Versi, Backup & Restore

### Upgrade ke Image GHCR Terbaru
```bash
cd ~/instabox-monitor
docker compose pull
docker compose up -d
```
*(Snapshot terakhir tersimpan di SQLite `account_snapshots`; jika container restart lebih cepat dari `POLL_INTERVAL_SECONDS`, data cache langsung tampil instan dan poller otomatis melanjutkan siklus tanpa duplikasi request.)*

### Backup Database & `APP_KEY`
1. **Simpan nilai `APP_KEY`** dari `.env` (tanpa `APP_KEY` yang sama, API key terenkripsi di database tidak bisa didekripsi).
2. Backup volume SQLite `/data`:
   ```bash
   docker run --rm \
     -v instabox_monitor_data:/data:ro \
     -v "$(pwd)":/backup \
     alpine tar czf /backup/instabox-monitor-data-$(date +%Y%m%d).tar.gz -C /data .
   ```

### Restore Database
```bash
docker compose down
docker run --rm \
  -v instabox_monitor_data:/data \
  -v "$(pwd)":/backup:ro \
  alpine tar xzf /backup/instabox-monitor-data-YYYYMMDD.tar.gz -C /data
docker compose up -d
```

---

## 9. Troubleshooting

| Gejala | Penyebab & Solusi |
| :--- | :--- |
| Akun berstatus **`Auto-Disabled (401)`** | API key invalid/kedaluwarsa/dicabut sebanyak `ACCOUNT_MAX_AUTH_FAILURES` kali berturut-turut. Buka menu **Accounts → Update Key**, masukkan API key baru (otomatis me-reset counter & mengaktifkan ulang poller). |
| Akun berstatus **`Key Error`** | `APP_KEY` berubah dibandingkan saat API key disimpan. Kembalikan `APP_KEY` asli di `.env` lalu restart, **atau** klik **Re-enter Key** di UI untuk mengenkripsi ulang dengan `APP_KEY` baru. |
| Tombol Start/Stop/Pause nonaktif | Akun ditandai **Read-Only**, atau API key hanya memiliki scope `machines:read` (terdeteksi otomatis saat `403 missing_scope`). Gunakan API key dengan scope `machines:write` bila ingin kontrol lifecycle. |
| File `logs/log-yyyy-mm-dd.log` tidak muncul | Pastikan `APP_ENV=DEBUG` (bukan `production`) dan direktori host `./logs` yang di-mount ke `/app/logs` dapat ditulis oleh UID `65532`. |
| Login terus kembali ke halaman login di HTTP lokal | Pastikan `COOKIE_SECURE=auto` (atau `false` jika mengakses lewat HTTP biasa tanpa TLS). |
