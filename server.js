
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_FILE = path.join(ROOT, "data", "pages.json");
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    ...headers
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), {
    "Content-Type": "application/json; charset=utf-8"
  });
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function tokenize(text) {
  return String(text).toLowerCase().match(/[a-z0-9]{2,}/g) || [];
}

function scoreDoc(doc, terms) {
  const tf = doc.terms || {};
  let score = 0;

  for (const term of terms) {
    score += (tf.title?.[term] || 0) * 10;
    score += (tf.description?.[term] || 0) * 6;
    score += (tf.text?.[term] || 0);
    if (doc.url.toLowerCase().includes(term)) score += 2;
    if ((doc.host || "").toLowerCase().includes(term)) score += 1;
  }

  return score;
}

function makeSnippet(doc, terms) {
  const hay = `${doc.title || ""}\n${doc.description || ""}\n${doc.text || ""}`;
  const lower = hay.toLowerCase();

  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at >= 0) {
      const start = Math.max(0, at - 80);
      const end = Math.min(hay.length, at + 180);
      return hay.slice(start, end).replace(/\s+/g, " ").trim();
    }
  }

  return (doc.description || doc.text || "").slice(0, 220).replace(/\s+/g, " ").trim();
}

async function loadIndex() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.pages) ? parsed.pages : [];
  } catch {
    return [];
  }
}

function filePathFor(urlPath) {
  const safe = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!safe.startsWith(PUBLIC_DIR)) return null;
  return safe;
}

async function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  const file = filePathFor(rel);
  if (!file) return send(res, 403, "Forbidden");

  try {
    const st = await fs.stat(file);
    if (st.isDirectory()) {
      const idx = path.join(file, "index.html");
      const html = await fs.readFile(idx);
      return send(res, 200, html, { "Content-Type": "text/html; charset=utf-8" });
    }

    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const body = await fs.readFile(file);
    return send(res, 200, body, { "Content-Type": type });
  } catch {
    const fallback = path.join(PUBLIC_DIR, "index.html");
    try {
      const html = await fs.readFile(fallback);
      return send(res, 200, html, { "Content-Type": "text/html; charset=utf-8" });
    } catch {
      return send(res, 404, "Not found");
    }
  }
}

async function handleSearch(req, res, url) {
  const q = (url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const size = Math.min(50, Math.max(1, Number(url.searchParams.get("size") || 10)));
  const blocked = (url.searchParams.get("blocked") || "")
    .split(/[, \n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (!q) {
    return sendJson(res, 200, {
      query: "",
      total: 0,
      page,
      size,
      results: []
    });
  }

  const pages = await loadIndex();
  const terms = tokenize(q);

  const scored = [];
  for (const doc of pages) {
    const host = (doc.host || "").toLowerCase();
    if (blocked.some((b) => host === b || host.endsWith(`.${b}`))) continue;

    const score = scoreDoc(doc, terms);
    if (score > 0) {
      scored.push({
        score,
        title: doc.title || doc.url,
        url: doc.url,
        host: doc.host || "",
        description: doc.description || "",
        snippet: makeSnippet(doc, terms),
        fetchedAt: doc.fetchedAt || "",
        sourceUrl: doc.sourceUrl || doc.url
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const total = scored.length;
  const start = (page - 1) * size;
  const results = scored.slice(start, start + size);

  sendJson(res, 200, {
    query: q,
    total,
    page,
    size,
    results,
    hasMore: start + size < total
  });
}

async function handleStats(res) {
  const pages = await loadIndex();
  sendJson(res, 200, {
    pages: pages.length,
    indexFile: DATA_FILE
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url) return send(res, 400, "Bad request");

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") return send(res, 204, "");

  if (url.pathname === "/api/search") return handleSearch(req, res, url);
  if (url.pathname === "/api/stats") return handleStats(res);

  return serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Search server running on http://localhost:${PORT}`);
});
