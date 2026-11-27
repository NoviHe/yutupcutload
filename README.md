<div align="center">
  <img src="assets/logo.svg" alt="YCL | YutupCutLoad" width="560" />

  <h1>YCL | YutupCutLoad</h1>

  <p>
    <strong>Partial YouTube &amp; Livestream VOD Clip Downloader</strong><br />
    Unduh potongan klip tertentu dari video YouTube maupun siaran ulang livestream berdurasi panjang (misal 11 jam) tanpa mengunduh seluruh file video.
  </p>

  <p>
    <img src="https://img.shields.io/badge/Tauri-v2-FFC131?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri v2" />
    <img src="https://img.shields.io/badge/Rust-Backend-DEA584?style=for-the-badge&logo=rust&logoColor=black" alt="Rust" />
    <img src="https://img.shields.io/badge/React_18-TypeScript-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 18 + TypeScript" />
    <img src="https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS v4" />
    <img src="https://img.shields.io/badge/Platform-Windows_x64-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows x64" />
  </p>
</div>

---

## Ringkasan Aplikasi

**YCL | YutupCutLoad** adalah aplikasi desktop native untuk **Windows (x64)** berbasis **Tauri v2 (Rust + Microsoft Edge WebView2)** dan **React + TypeScript** yang dirancang untuk mengambil bagian-bagian tertentu (klip) dari video YouTube atau VOD livestream berdurasi sangat panjang secara efisien.

Alih-alih mengunduh satu file video utuh berukuran puluhan gigabyte hanya untuk mengambil beberapa menit momen penting, YutupCutLoad:
1. Mengambil metadata video (`yt-dlp --dump-single-json --no-playlist`) termasuk daftar resolusi dan YouTube Chapters.
2. Menampilkan preview video secara streaming langsung di dalam aplikasi agar pengguna bisa menandai titik **Start** dan **End** secara cepat.
3. Mengunduh hanya segmen waktu yang dipilih lewat `--download-sections` pada `yt-dlp` dan memotongnya melalui `ffmpeg` secara paralel lewat antrean asinkron Tokio.

---

## Fitur Utama

### 1. Metadata & Format Fetcher
- Mengambil judul, channel, durasi total (`HH:MM:SS`), thumbnail, resolusi/FPS yang tersedia, serta daftar **YouTube Chapters** via `yt-dlp --dump-single-json --no-playlist`.
- Mendeteksi status **VOD Livestream** (`wasLive`) dan **Sedang Live** (`isLive`).

### 2. Preview Player Hybrid & Timeline Interaktif
- **Mode Default — YouTube IFrame Player API:** Streaming instan untuk VOD panjang tanpa mengunduh file penuh.
- **Mode Fallback — Direct Stream:** Jika video memblokir embed (`Error 101/150`), pengguna bisa beralih ke pemutaran `<video>` HTML5 menggunakan stream URL dari `yt-dlp`.
- **Navigasi Cepat:** Timeline interaktif dengan penanda seleksi aktif dan daftar klip tersimpan, tombol loncat (`-5m`, `-30s`, `-5s`, `+5s`, `+30s`, `+5m`), input langsung `Go to HH:MM:SS`, serta tombol `Set Start [` dan `Set End ]`.

### 3. Tiga Mode Pembuatan Klip
- **Custom Range:** Tambah rentang waktu bebas (`HH:MM:SS` atau `MM:SS`) dengan label opsional, edit inline di panel antrean, serta **Bulk Import / Export Teks** (format baris seperti `00:45:10-00:48:30 Boss Fight`).
- **Auto-Split per Durasi:** Bagi seluruh video atau sub-rentang tertentu berdasarkan durasi chunk (menit dan detik), dukungan **Overlap** antar klip (detik), dan prefix label otomatis.
- **Split by Chapters:** Ambil daftar YouTube Chapters secara otomatis dengan filter pencarian dan pilihan selektif per chapter.

### 4. Kualitas, Format & Mode Pemotongan
- **Preset Kualitas Video:** `Best`, `2160p (4K)`, `1440p (2K)`, `1080p`, `720p`, `480p` dengan container `MP4` atau `MKV`.
- **Audio Only:** Ekstrak audio saja ke format `MP3`, `M4A (AAC)`, atau `OPUS`.
- **Mode Pemotongan:**
  - **Cepat (Stream Copy):** Tanpa re-encode, sangat cepat mengikuti keyframe terdekat (`±1–4s`).
  - **Presisi (Re-encode):** Akurat ke detik/frame target dengan `--force-keyframes-at-cuts`.

### 5. Antrean Paralel & Stabilitas Proses Windows
- Manajemen antrean asinkron berbasis **Tokio + Semaphore** dengan batas paralel `1–4` klip sekaligus (default `2`).
- Progress real-time per klip: persentase, kecepatan unduh, ETA, ukuran terunduh, dan tahap proses (`Pending`, `Downloading`, `Processing`, `Done`, `Cancelled`, `Error`).
- Panel log proses per klip yang dapat dibuka-tutup (*collapsible*), kontrol **Mulai Download**, **Cancel**, **Batalkan Semua**, **Retry**, **Hapus Selesai**, serta tombol buka folder/file hasil.
- **Windows Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`):** Memastikan proses `yt-dlp.exe` dan child process `ffmpeg.exe` berhenti bersih tanpa proses yatim saat klip dibatalkan atau aplikasi ditutup.

### 6. Pengaturan, Penamaan File & Cookies
- **Template Nama File:** Dapat dikustomisasi (default `{title}_{index}_{start}-{end}_{label}`), lengkap dengan sanitasi karakter ilegal Windows dan proteksi tabrakan nama file.
- **Autentikasi & Runtime:** Mendukung `--cookies-from-browser` (`Chrome`, `Edge`, `Firefox`, `Brave`) atau file `cookies.txt`, opsi `preferHlsForVod`, deteksi otomatis `node.exe` (`--js-runtimes node`), serta path kustom binary `yt-dlp` dan `ffmpeg`.
- Preferensi pengguna disimpan lokal di `%APPDATA%\YutupCutLoad\settings.json`.

---

## Shortcut Keyboard

Saat fokus tidak berada di kolom input:

| Shortcut | Fungsi |
|---|---|
| `Space` | Play / Pause preview |
| `←` / `→` | Mundur / maju 5 detik |
| `Shift + ←` / `Shift + →` | Mundur / maju 30 detik |
| `[` | Set titik **Start** dari posisi playhead saat ini |
| `]` | Set titik **End** dari posisi playhead saat ini |

---

## Tech Stack & Struktur Proyek

- **Desktop & Backend:** Tauri v2 (`tauri`, `tauri-plugin-dialog`, `tauri-plugin-opener`), Rust (`tokio`, `serde`, `serde_json`, `regex`, `uuid`, `dirs`, `windows-sys`)
- **Frontend:** React 18, TypeScript, Vite 6, Tailwind CSS v4, Lucide Icons
- **Media Engine Eksternal:** `yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe`

```text
yutupcutload/
├── assets/
│   └── logo.svg                 # Logo aplikasi YCL | YutupCutLoad
├── bin/                         # Binary portabel yt-dlp.exe, ffmpeg.exe, ffprobe.exe (di-ignore git)
├── src/                         # Frontend React + TypeScript + Tailwind
│   ├── App.tsx
│   ├── components/
│   │   ├── UrlBar.tsx           # Input URL, status environment & modal pengaturan lanjutan
│   │   ├── VideoPreview.tsx     # Player hybrid (IFrame / Direct Stream) & timeline scrubber
│   │   ├── ClipBuilderTabs.tsx  # Pembuatan klip: Custom, Auto-Split, Chapters
│   │   ├── QueuePanel.tsx       # Antrean unduhan paralel, progress & log per klip
│   │   └── OutputSettingsBar.tsx# Pengaturan kualitas, format, mode potong & folder output
│   ├── lib/
│   │   ├── tauriApi.ts          # Wrapper invoke command & event listener Tauri
│   │   └── time.ts              # Format & parsing timestamp
│   └── types/
│       └── clip.ts              # Definisi tipe data frontend
└── src-tauri/                   # Backend Rust (Tauri v2)
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
        ├── main.rs
        ├── lib.rs               # Registrasi plugin, state antrean & cleanup saat exit
        ├── commands.rs          # Handler #[tauri::command]
        ├── models.rs            # Struct metadata, konfigurasi, event & job
        ├── config.rs            # Load/save settings.json & deteksi binary (bin/ & PATH)
        ├── ytdlp.rs             # Eksekusi metadata, stream URL & argumen yt-dlp
        ├── splitter.rs          # Logika pure Rust: auto-split, bulk parser & sanitasi nama
        ├── queue.rs             # Manajemen antrean Tokio, semaphore & progress parser
        └── process.rs           # Guard child process Windows Job Object
```

---

## Prasyarat & Menjalankan dari Source

### Prasyarat
- **OS:** Windows 11 (x64)
- **Toolchain:** Rust & Cargo, MSVC Build Tools, Node.js & npm, Microsoft Edge WebView2 Runtime
- **Binary Eksternal:** Siapkan `yt-dlp.exe`, `ffmpeg.exe`, dan `ffprobe.exe`, lalu letakkan di folder `bin/` pada root proyek (atau pastikan tersedia di `PATH` sistem / atur path manual di menu **Pengaturan**).

### Instalasi & Menjalankan

```bash
# 1. Install dependensi frontend
npm install

# 2. Jalankan mode development (Tauri + Vite)
npm run tauri:dev

# 3. Build executable release (tanpa installer bundle)
npm run tauri:build

# 4. Jalankan unit test backend Rust (pure logic splitter, parser, sanitasi)
cargo test --manifest-path src-tauri/Cargo.toml
```
