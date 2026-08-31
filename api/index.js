const express = require("express");
const cors = require("cors");

const app = express();

// ─── Konfigurasi ───────────────────────────────────────────────
// Dukung 1 atau lebih URL music.json.
// Contoh env:
// GITHUB_SONGS_URL=https://.../music.json
// GITHUB_SONGS_URLS=https://.../music-a.json,https://.../music-b.json
// GITHUB_SONGS_URLS=["https://.../a.json","https://.../b.json"]
const DEFAULT_MUSIC_URLS = [
    "https://raw.githubusercontent.com/this-repo/music-db/refs/heads/main/metadata/music.json",
    "https://raw.githubusercontent.com/this-repo/music-db-v2/refs/heads/main/metadata/music.json"
];

function parseMusicSources(rawValue) {
    if (!rawValue) return [];

    if (Array.isArray(rawValue)) {
        return rawValue
            .map((value) => String(value).trim())
            .filter(Boolean);
    }

    if (typeof rawValue !== "string") {
        return [String(rawValue).trim()].filter(Boolean);
    }

    const trimmed = rawValue.trim();
    if (!trimmed) return [];

    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
            return parsed
                .map((value) => String(value).trim())
                .filter(Boolean);
        }
        if (typeof parsed === "string" && parsed.trim()) {
            return [parsed.trim()];
        }
    } catch (_error) {
        // Jika bukan JSON, lanjutkan ke parsing CSV.
    }

    return trimmed
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
}

const MUSIC_SOURCES = parseMusicSources(
    process.env.GITHUB_SONGS_URLS || process.env.GITHUB_SONGS_URL || DEFAULT_MUSIC_URLS
);

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
function normalizeSongsPayload(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (payload && Array.isArray(payload.songs)) {
        return payload.songs;
    }

    if (payload && Array.isArray(payload.data)) {
        return payload.data;
    }

    if (payload && Array.isArray(payload.tracks)) {
        return payload.tracks;
    }

    return [];
}

function mergeSongs(songLists) {
    const merged = new Map();

    for (const songs of songLists) {
        for (const song of songs) {
            if (!song || typeof song !== "object") continue;

            const key = song.id || `${song.title || "untitled"}|${song.artist || "unknown"}|${song.url || ""}`;
            if (!merged.has(key)) {
                merged.set(key, song);
            }
        }
    }

    return Array.from(merged.values());
}

async function getSongs() {
    const now = Date.now();

    // Return cache jika masih valid
    if (cache.data && now - cache.timestamp < CACHE_TTL) {
        return cache.data;
    }

    const sources = MUSIC_SOURCES.length ? MUSIC_SOURCES : DEFAULT_MUSIC_URLS;
    const results = await Promise.allSettled(
        sources.map(async (url) => {
            const res = await fetch(url);

            if (!res.ok) {
                throw new Error(`GitHub fetch gagal untuk ${url}: ${res.status} ${res.statusText}`);
            }

            const payload = await res.json();
            return normalizeSongsPayload(payload);
        })
    );

    const songSets = [];
    const failedSources = [];

    results.forEach((result, index) => {
        if (result.status === "fulfilled") {
            songSets.push(result.value);
        } else {
            failedSources.push({
                url: sources[index],
                message: result.reason?.message || "Unknown fetch error",
            });
        }
    });

    if (!songSets.length) {
        throw new Error(
            failedSources.length
                ? `Semua sumber gagal: ${failedSources.map((item) => `${item.url} (${item.message})`).join("; ")}`
                : "Tidak ada data lagu yang berhasil diambil."
        );
    }

    if (failedSources.length) {
        console.warn("Beberapa sumber music gagal diambil:", failedSources);
    }

    const songs = mergeSongs(songSets);

    // Simpan ke cache
    cache.data = songs;
    cache.timestamp = now;

    return songs;
}

// ─── Routes ────────────────────────────────────────────────────

// Health check
app.get("/", (_req, res) => {
    res.status(200).json({
        success: true,
        code: 200,
        name: "Songs API Hub",
        version: "1.0.0",
        message: "Songs API is running",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
        sources: MUSIC_SOURCES.length ? MUSIC_SOURCES : DEFAULT_MUSIC_URLS,
        endpoints: {
            getAllSongs: "/api/songs",
            getSongByName: "/api/songs?q={name}"
        },
        documentation: "#",
        maintainer: {
            name: "RyuXyro",
            github: "https://github.com/ryuxyro",
            role: "Lead Developer & Founder"
        }
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