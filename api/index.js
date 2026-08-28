const express = require("express");
const cors = require("cors");

const app = express();

// ─── Konfigurasi ───────────────────────────────────────────────
// Ganti URL ini dengan path raw file songs.json di repo GitHub Anda
// Contoh: https://raw.githubusercontent.com/username/repo/main/songs.json
const GITHUB_RAW_URL =
    process.env.GITHUB_SONGS_URL ||
    "https://raw.githubusercontent.com/this-repo/music-db/refs/heads/main/metadata/music.json";

// Cache sederhana agar tidak fetch GitHub setiap request
let cache = {
    data: null,
    timestamp: 0,
};
const CACHE_TTL = 5 * 60 * 1000; // 5 menit

// ─── Middleware ─────────────────────────────────────────────────
app.use(
    cors({
        origin: "*",          // Izinkan semua origin (sesuaikan jika perlu)
        methods: ["GET"],
        allowedHeaders: ["Content-Type"],
    })
);

// ─── Helper: Fetch & Cache ─────────────────────────────────────
async function getSongs() {
    const now = Date.now();

    // Return cache jika masih valid
    if (cache.data && now - cache.timestamp < CACHE_TTL) {
        return cache.data;
    }

    const res = await fetch(GITHUB_RAW_URL);

    if (!res.ok) {
        throw new Error(`GitHub fetch gagal: ${res.status} ${res.statusText}`);
    }

    const songs = await res.json();

    // Simpan ke cache
    cache.data = songs;
    cache.timestamp = now;

    return songs;
}

// ─── Routes ────────────────────────────────────────────────────

// Health check
app.get("/", (_req, res) => {
    res.json({
        status: "ok",
        message: "Songs API is running 🎵",
        endpoints: ["/api/songs"],
    });
});

// Endpoint utama: GET /api/songs
// Query params opsional: ?q=keyword  atau  ?title=...  atau  ?artist=...
app.get("/api/songs", async (req, res) => {
    try {
        const songs = await getSongs();
        const { q, title, artist } = req.query;

        let results = songs;

        // Filter berdasarkan query umum (mencocokkan title ATAU artist)
        if (q) {
            const keyword = q.toLowerCase();
            results = results.filter(
                (s) =>
                    (s.title && s.title.toLowerCase().includes(keyword)) ||
                    (s.artist && s.artist.toLowerCase().includes(keyword))
            );
        }

        // Filter spesifik berdasarkan title
        if (title) {
            const t = title.toLowerCase();
            results = results.filter(
                (s) => s.title && s.title.toLowerCase().includes(t)
            );
        }

        // Filter spesifik berdasarkan artist
        if (artist) {
            const a = artist.toLowerCase();
            results = results.filter(
                (s) => s.artist && s.artist.toLowerCase().includes(a)
            );
        }

        res.json({
            success: true,
            total: results.length,
            data: results,
        });
    } catch (err) {
        console.error("Error:", err.message);
        res.status(500).json({
            success: false,
            error: "Gagal mengambil data lagu.",
            detail: err.message,
        });
    }
});

// ─── Export untuk Vercel Serverless ────────────────────────────
// Vercel memanggil module.exports sebagai handler
module.exports = app;

// ─── Local development (opsional) ──────────────────────────────
if (process.env.NODE_ENV !== "production") {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Server lokal berjalan di http://localhost:${PORT}`);
    });
}
