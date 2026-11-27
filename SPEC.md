# Spesifikasi Aplikasi: YutupCutLoad (Tauri v2 + Rust)

Dokumen ini berisi rancangan lengkap aplikasi desktop **YutupCutLoad** untuk mengunduh potongan video YouTube (termasuk siaran ulang livestream berdurasi sangat panjang seperti 11 jam) tanpa harus mengunduh seluruh file video.

---

## 1. Ringkasan & Tujuan

- **Nama Proyek:** `YutupCutLoad` (nama sementara, bisa diubah)
- **Tujuan Utama:** Mengambil dan memotong bagian-bagian tertentu (klip) dari video atau VOD livestream YouTube secara efisien lewat HTTP Range Request / segmen DASH & HLS.
- **Target Platform:** Windows 11 (x64) native desktop app.
- **Prinsip Kerja:**
  - Preview video panjang secara streaming langsung di aplikasi untuk menentukan titik `Start` dan `End`.
  - Mendukung pembuatan banyak klip sekaligus (custom range, auto-split per durasi, atau split per YouTube Chapters).
  - Eksekusi antrean unduhan secara paralel melalui backend Rust yang mengontrol `yt-dlp` dan `ffmpeg`.

---

## 2. Stack Teknologi & Status Environment Terukur

### Arsitektur Stack
- **Desktop Framework:** Tauri v2 (Rust backend + Microsoft Edge WebView2)
- **Frontend UI (Usulan):** React + TypeScript + Vite + Tailwind CSS *(bisa diganti ke Svelte/Vue/Solid atau HTML+TS vanilla jika kamu prefer lain)*
- **Backend Rust:**
  - `tauri` v2 + plugin resmi (`tauri-plugin-dialog` untuk pilih folder/file, `tauri-plugin-opener` untuk buka folder hasil)
  - `tokio` (async runtime, manajemen proses anak, semaphore concurrency limit)
  - `serde` & `serde_json` (parsing output JSON `yt-dlp` dan konfigurasi)
  - `uuid` (ID unik tiap job/klip)
  - Parser terstruktur (`regex` / pure Rust parser) untuk progress template `yt-dlp` dan input timestamp
- **Media Engine (Eksternal / Sidecar):**
  - `yt-dlp.exe`
  - `ffmpeg.exe` & `ffprobe.exe`
  - **Urutan pencarian binary:** folder `bin/` lokal di sebelah executable app $\rightarrow$ `PATH` sistem $\rightarrow$ wizard/tombol bantuan download jika belum tersedia.

### Status Environment Mesin Saat Ini (Hasil Pengecekan Langsung)

| Komponen | Status | Versi / Lokasi Terukur |
|---|---|---|
| OS | Terpasang | `Microsoft Windows 11 Pro` |
| Rust & Cargo | Terpasang | `rustc 1.99.1`, `cargo 1.99.1` (`C:\Users\Administrator\.cargo\bin\`) |
| MSVC Build Tools | Terpasang | Visual Studio `18.11.12306.390` (VC Tools x86/x64) |
| Node.js & npm | Terpasang | `v24.21.0` (`C:\Program Files\nodejs\`) — juga bisa dipakai sebagai JS runtime `yt-dlp` bila perlu |
| Edge WebView2 Runtime | Terpasang | `148.0.3967.54` |
| `winget` | Terpasang | `C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\winget.exe` |
| `yt-dlp` | Belum ada di PATH | Perlu disiapkan pada fase setup (lokal `bin/` atau global via `winget`) |
| `ffmpeg` | Belum ada di PATH | Perlu disiapkan pada fase setup (lokal `bin/` atau global via `winget`) |

---

## 3. Alur Kerja Pengguna (User Flow)

1. **Input URL:** Pengguna paste link YouTube (video biasa atau VOD livestream 11 jam) lalu klik **Muat Video**.
2. **Fetch Metadata:** Backend Rust menjalankan `yt-dlp --dump-single-json --no-playlist` dan menampilkan judul, thumbnail, channel, durasi total, daftar resolusi tersedia, dan daftar YouTube Chapters (jika ada).
3. **Preview & Tandai Klip:** Video langsung dimuat di player. Pengguna bisa scrub timeline, loncat cepat, dan membuat daftar klip lewat 3 mode (**Custom Range**, **Auto-Split**, atau **Chapters**).
4. **Konfigurasi Output:** Pilih resolusi/audio, format container (`MP4`/`MKV`), mode pemotongan (**Cepat** vs **Presisi**), concurrency antrean, dan folder output.
5. **Eksekusi Antrean:** Klik **Mulai Download**. Backend memproses hingga $N$ klip secara paralel dan mengirim progress real-time ke UI.
6. **Selesai / Kelola:** Pengguna memantau progress, membatalkan klip tertentu, mengulang klip yang gagal, atau langsung klik **Buka Folder** pada hasil klip.

---

## 4. Daftar Fitur

### A. Fitur Inti (MVP — Fase 1)

1. **Video Metadata & Format Fetcher**
   - Mengambil metadata video via `yt-dlp --dump-single-json --no-playlist`.
   - Menampilkan info penting: judul, durasi total (`HH:MM:SS`), resolusi/FPS yang benar-benar tersedia pada video tersebut, dan daftar Chapters.
   - Validasi awal jika URL tidak valid, video private, atau live stream masih aktif/belum menjadi VOD penuh.

2. **Preview Player Hybrid**
   - **Mode Default — YouTube IFrame Player API:** Instan untuk VOD 11 jam tanpa beban bandwidth berlebih, mendukung scrub timeline dan pemanggilan `getCurrentTime()` / `seekTo()`.
   - **Kontrol Navigasi Cepat VOD Panjang:**
     - Tombol loncat cepat: `-5m`, `-30s`, `-5s`, `+5s`, `+30s`, `+5m`.
     - Input langsung loncat ke timestamp (`Go to HH:MM:SS`).
     - Tombol cepat **Set Start** dan **Set End** langsung dari posisi playhead saat ini.
     - Shortcut keyboard: `Space` (play/pause), `←` / `→` (geser detik), `[` (Set Start), `]` (Set End), `Enter` (tambah ke daftar klip).
   - **Mode Fallback — Direct Stream URL (`yt-dlp -g`):**
     - Jika pemilik video memblokir embed (`error 101` / `150`), UI menyediakan tombol (atau auto-fallback) untuk mengambil stream URL sementara dan memutarnya lewat `<video>` HTML5 / WebView2 player.

3. **3 Mode Pembuatan Klip**
   - **Mode 1 — Custom Range:**
     - Tambah banyak rentang waktu secara bebas (`Start` – `End` dalam format `HH:MM:SS` atau `HH:MM:SS.mmm`).
     - Label/nama kustom per klip (opsional).
     - Edit inline, hapus, atau duplikasi klip sebelum mulai.
     - **Bulk Import / Export Teks:** Paste banyak timestamp sekaligus, misal:
       ```text
       00:45:10-00:48:30 Boss Fight Phase 1
       03:12:00-03:15:45 Momen Lucu
       ```
   - **Mode 2 — Auto-Split per Durasi:**
     - Bagi video penuh (atau hanya sub-rentang tertentu, misal dari `02:00:00` sampai `05:00:00`) menjadi beberapa bagian otomatis setiap $N$ menit atau detik (misal tiap 15 menit).
     - Opsi **Overlap** (misal 3–5 detik antar bagian) agar dialog/momen tidak terpotong di perbatasan.
     - Preview daftar hasil split sebelum dimasukkan ke antrean download.
   - **Mode 3 — Split by Chapters:**
     - Mengambil daftar YouTube Chapters otomatis.
     - Checkbox untuk pilih semua atau hanya chapter tertentu.
     - Nama chapter otomatis dipakai sebagai label file klip.

4. **Pilihan Kualitas & Format**
   - Preset kualitas video: `Best`, `2160p (4K)`, `1440p`, `1080p`, `720p`, `480p` (disesuaikan/diberi penanda sesuai resolusi yang tersedia dari metadata).
   - Container video: `MP4` (kompatibilitas luas) atau `MKV`.
   - Opsi `Audio Only`: `MP3`, `M4A`, atau `OPUS`.

5. **Mode Pemotongan (Cepat vs Presisi)**
   - **Cepat (Stream Copy / Keyframe Cut):** Mengambil segmen tanpa re-encode. Sangat cepat dan hemat CPU, namun titik potong bisa bergeser beberapa detik ke keyframe terdekat.
   - **Presisi (Force Keyframes / Re-encode):** Menggunakan `--force-keyframes-at-cuts` sehingga titik `Start` dan `End` akurat hingga detik/frame; hanya segmen klip yang diunduh yang di-re-encode oleh `ffmpeg`.

6. **Queue & Download Manager (Rust Async)**
   - Batas unduhan paralel (*concurrency limit*): default `2`, bisa diatur `1–4`.
   - Status jelas per klip: `Pending`, `Downloading`, `Processing`, `Done`, `Cancelled`, `Error`.
   - Progress real-time per klip: persentase, kecepatan download, ukuran terunduh/estimasi, dan ETA (di-parse terstruktur dari `--progress-template` + `--newline`).
   - Kontrol penuh: **Cancel** per klip, **Cancel All**, **Retry Failed**, **Clear Completed**.
   - Panel log proses per klip yang bisa dibuka-tutup (*collapsible*) untuk troubleshooting saat error.

7. **Output Naming & File Safety**
   - Template nama file yang bisa dikustomisasi, default: `{title}_{index}_{start}-{end}_{label}`.
   - Sanitasi otomatis karakter ilegal Windows (`\ / : * ? " < > |`) dan pemangkasan panjang path aman.
   - Proteksi tabrakan nama file: otomatis menambah suffix `(1)`, `(2)`, dst. jika file sudah ada (tidak menimpa file lama secara diam-diam).
   - Menyimpan preferensi terakhir pengguna (folder output, kualitas, mode potong, concurrency) secara lokal.

---

### B. Kandidat Fitur Tambahan (Opsional — Untuk Kamu Pilih)

Fitur di bawah ini tidak wajib masuk Fase 1, silakan tentukan mana yang mau langsung dimasukkan ke MVP atau ditunda ke Fase 2:

1. **Cookies / Browser Auth (`--cookies-from-browser` / `cookies.txt`):** Untuk video member-only, age-restricted, atau saat YouTube memunculkan verifikasi anti-bot.
2. **Download Subtitle (`.srt` / `.vtt`):** Ikut mengunduh dan memotong subtitle sesuai timestamp klip.
3. **Gabung Klip (Merge / Highlight Reel):** Menggabungkan beberapa klip hasil unduhan menjadi satu video kompilasi lewat `ffmpeg concat`.
4. **Preset Aspect Ratio / Crop (9:16 Vertikal):** Export siap upload untuk YouTube Shorts / TikTok / Reels.
5. **Hardware Acceleration Toggle (NVENC / QSV / AMF):** Mempercepat encoding di mode **Presisi** menggunakan GPU NVIDIA/Intel/AMD jika terdeteksi.
6. **Tombol Update `yt-dlp`:** Update binary `yt-dlp.exe` langsung dari dalam aplikasi jika YouTube mengubah format/player.
7. **Session & History Persistence:** Menyimpan daftar klip/antrean yang belum selesai saat aplikasi ditutup agar bisa dilanjutkan lagi.

---

## 5. Arsitektur Teknis & Desain Backend Rust

### Struktur Direktori Proyek (Rencana)

```text
E:\AI\yutupcutload\
├── SPEC.md
├── package.json
├── vite.config.ts
├── index.html
├── src/                         # Frontend (React + TypeScript + Tailwind)
│   ├── App.tsx
│   ├── components/
│   │   ├── UrlBar.tsx
│   │   ├── VideoPreview.tsx
│   │   ├── ClipBuilderTabs.tsx  # Custom / Auto-Split / Chapters
│   │   ├── QueuePanel.tsx
│   │   └── SettingsBar.tsx
│   ├── lib/
│   │   ├── tauriApi.ts          # Wrapper invoke & listen event
│   │   └── time.ts              # Format & parse HH:MM:SS
│   └── types/
│       └── clip.ts
└── src-tauri/                   # Backend Rust (Tauri v2)
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/
    └── src/
        ├── main.rs
        ├── lib.rs               # Setup Tauri state, plugins, lifecycle cleanup
        ├── models.rs            # Struct VideoMetadata, Chapter, ClipJob, Settings
        ├── commands.rs          # Tauri #[tauri::command] handlers
        ├── ytdlp.rs             # Builder argumen yt-dlp & parser metadata/progress
        ├── splitter.rs          # Pure logic: auto-split, validasi range, sanitasi nama
        ├── queue.rs             # Async Tokio queue + Semaphore + Cancel token
        ├── process.rs           # Spawn & Windows Job Object / tree-kill cleanup
        └── config.rs            # Load/save preferensi & deteksi binary bin/ / PATH
```

### Kontrak Tauri Commands & Events

| Tipe | Nama | Fungsi |
|---|---|---|
| Command | `check_environment` | Cek keberadaan `yt-dlp.exe` dan `ffmpeg.exe` + versinya |
| Command | `fetch_video_info(url, cookies?)` | Ambil metadata, durasi, format tersedia, dan daftar chapters |
| Command | `resolve_stream_url(url, quality)` | Ambil direct stream URL untuk fallback preview non-embed |
| Command | `generate_auto_split(params)` | Hitung daftar segmen dari durasi total / sub-range + overlap |
| Command | `enqueue_clips(jobs, settings)` | Validasi dan masukkan daftar klip ke antrean backend |
| Command | `cancel_clip(job_id)` | Batalkan satu klip yang sedang berjalan atau menunggu |
| Command | `cancel_all_clips()` | Batalkan seluruh antrean aktif |
| Command | `retry_clip(job_id)` | Jalankan ulang klip berstatus `Error` / `Cancelled` |
| Command | `get_settings` / `save_settings` | Baca & simpan konfigurasi aplikasi |
| Event | `clip://progress` | Kirim `{ job_id, percent, speed, eta, downloaded_bytes, stage }` |
| Event | `clip://status` | Kirim perubahan status (`Pending` $\rightarrow$ `Downloading` $\rightarrow$ `Processing` $\rightarrow$ `Done`/`Error`/`Cancelled`) + output path |
| Event | `clip://log` | Kirim baris stdout/stderr terpilih ke panel log klip |

### Detail Teknis Penting (Khusus VOD 11 Jam & Windows)

1. **Perintah `yt-dlp` untuk Download Parsial:**
   - Menggunakan `--download-sections "*START-END"` agar `yt-dlp` hanya mengambil fragmen/rentang byte terkait.
   - Menggunakan `--progress-template` berformat terstruktur + `--newline` agar backend Rust bisa mem-parse progress secara deterministik tanpa menebak teks bebas.
   - Menggunakan `--concurrent-fragments` (misal `4`) untuk mempercepat pengunduhan segmen HLS/DASH.
   - Menyertakan `--ffmpeg-location <dir>` secara eksplisit jika binary berada di folder `bin/` lokal.
   - Dukungan `--js-runtimes node` bila diperlukan oleh versi `yt-dlp` terbaru untuk ekstraksi signature YouTube.
2. **Pembersihan Proses Anak di Windows (Tree-Kill):**
   - `yt-dlp.exe` sering men-spawn `ffmpeg.exe` sebagai child process. Jika hanya membunuh `yt-dlp.exe`, `ffmpeg.exe` bisa tertinggal sebagai proses yatim (*orphan*) dan mengunci file output.
   - Backend `process.rs` akan mengikat child process ke **Windows Job Object** (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) atau menjalankan process-tree termination saat `Cancel` ditekan maupun saat aplikasi ditutup, serta membersihkan file `.part` / temp sisa pembatalan.
3. **Validasi Batas & Keamanan Data:**
   - Semua rentang divalidasi di frontend dan dicek ulang di backend Rust: `start >= 0`, `start < end`, `end <= video_duration`, angka finite (bukan `NaN`/`Infinity`), dan folder output valid serta writable.
   - Sanitasi karakter ilegal pada judul video dan label chapter sebelum dipakai sebagai nama file.
4. **Unit Test Pure Logic (Tanpa Koneksi Internet):**
   - Modul `splitter.rs`, parser timestamp (`HH:MM:SS` / `MM:SS` / detik), parser progress template `yt-dlp`, dan sanitizer nama file ditulis sebagai pure functions sehingga bisa diuji langsung lewat `cargo test`.

---

## 6. Rancangan Tata Letak UI (Wireframe)

```text
+-----------------------------------------------------------------------------------+
| [ URL YouTube: https://youtube.com/watch?v=...        ] [Muat]  [yt-dlp OK|ffmpeg OK] |
+-----------------------------------------+-----------------------------------------+
| PREVIEW VIDEO (WebView Player)          | DAFTAR KLIP & ANTREAN (Queue)           |
| +-------------------------------------+ | [Nama Klip]   [Rentang]      [Status]   |
| |                                     | | 1. Highlight  01:12:00-15:00 [Done]     |
| |     YouTube IFrame / Direct Stream  | | 2. BossFight  04:05:10-08:40 [64% | X]  |
| |                                     | | 3. Part 3     06:30:00-45:00 [Pending]  |
| +-------------------------------------+ |                                         |
| Playhead: 04:05:12 / 11:02:45           | [Start All] [Cancel All] [Clear Done]   |
| [-5m] [-30s] [-5s] [+5s] [+30s] [+5m]   +-----------------------------------------+
| [Set Start]  [Set End]  [Go to: __:__:__] | PENGATURAN OUTPUT                      |
+-----------------------------------------+ Kualitas : [1080p v]  Format: [MP4 v]   |
| BUAT KLIP: [Custom] [Auto-Split] [Chapters] | Mode     : (o) Cepat  ( ) Presisi   |
| Start [04:05:10] End [04:08:40]         | Paralel  : [2 v]                        |
| Label [BossFight                      ] | Folder   : [D:\Clips\...     ] [Pilih] |
| [+ Tambah Klip]   [Bulk Import Teks]    | Template : [{title}_{index}_{start}-{end}] |
+-----------------------------------------+-----------------------------------------+
| [v] Log Proses: [yt-dlp] Downloading section *04:05:10-04:08:40 (4.8 MiB/s)...    |
+-----------------------------------------------------------------------------------+
```

---

## 7. Rencana Fase Implementasi & Verifikasi

- **Fase 0 — Persiapan Environment & Scaffold:**
  - Siapkan `yt-dlp.exe` dan `ffmpeg.exe` (di folder lokal `bin/` atau sistem via `winget`).
  - Scaffold proyek Tauri v2 + frontend dan pastikan `cargo check` serta build dev jalan.
- **Fase 1 — Core Backend Rust & Unit Tests:**
  - Implementasi `models.rs`, `splitter.rs`, `ytdlp.rs`, `process.rs` (Windows Job Object tree-kill), `queue.rs`, dan `config.rs`.
  - Verifikasi pure logic dengan `cargo test`.
- **Fase 2 — Frontend UI & Preview Player:**
  - Implementasi player hybrid (IFrame + fallback direct stream), tab **Custom / Auto-Split / Chapters**, panel antrean real-time, dan settings.
  - Verifikasi type-check (`tsc --noEmit`) dan build frontend (`vite build`).
- **Fase 3 — Integrasi & Uji Nyata:**
  - Build penuh `cargo tauri build` / dev run.
  - Uji fetch metadata, preview seeking, dan unduhan parsial multi-klip pada video YouTube & VOD panjang nyata, termasuk uji tombol Cancel dan validasi file hasil.

---

## 8. Poin Review untuk Kamu

Sebelum saya mulai menulis kode proyeknya, silakan cek dan beri tahu:
1. **Fitur Opsional:** Dari daftar **4.B** (Cookies/Auth, Subtitle terpotong, Merge/Gabung klip, Crop 9:16, GPU Hardware Accel, Auto-update `yt-dlp`, History session), mana yang ingin langsung masuk di **Fase 1** dan mana yang ditunda?
2. **Binary `yt-dlp` & `ffmpeg`:** Mau diletakkan **portabel di dalam folder proyek/app (`bin/`)** agar nanti aplikasi mudah dibagikan, atau di-install ke **sistem Windows via `winget`**?
3. **Frontend Stack:** Apakah **React + TypeScript + Tailwind CSS** sudah cocok, atau kamu lebih suka stack lain (misal Svelte / Vue / vanilla TS)?
4. **Ada fitur atau detail workflow lain yang kurang?** Silakan tambahkan langsung sebelum fase coding dimulai.
