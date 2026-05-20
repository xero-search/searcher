
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const OUT_FILE = path.join(DATA_DIR, "pages.json");
const SEEDS_FILE = path.join(ROOT, "seeds.txt");

const MAX_PAGES = Number(process.env.MAX_PAGES || 200);
const MAX_DEPTH = Number(process.env.MAX_DEPTH || 2);
const DELAY_MS = Number(process.env.DELAY_MS || 300);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 12000);
const USER_AGENT =
  process.env.USER_AGENT || "ManualSearchBot/1.0 (+local crawler)";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeEntities(text) {
  return String(text)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function normalizeUrl(raw, base) {
  try {
    const u = base ? new URL(raw, base) : new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function stripHtml(html) {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<template[\s\S]*?<\/template>/gi, " ")
      .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|td|section|article|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]).slice(0, 200) : "";
}

function extractMetaDescription(html) {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["'][^>]*>/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return stripHtml(m[1]).slice(0, 400);
  }
  return "";
}

function extractCanonical(html, baseUrl) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i);
  if (!m) return baseUrl;
  const url = normalizeUrl(m[1], baseUrl);
  return url || baseUrl;
}

function extractLinks(html, baseUrl) {
  const links = new Set();
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>"']+))/gi;
  let match;
  while ((match = re.exec(html))) {
    const href = match[1] || match[2] || match[3];
    if (!href) continue;
    const trimmed = href.trim();
    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("mailto:") ||
      trimmed.startsWith("tel:") ||
      trimmed.startsWith("javascript:")
    ) {
      continue;
    }
    const absolute = normalizeUrl(trimmed, baseUrl);
    if (absolute) links.add(absolute);
  }
  return [...links];
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .match(/[a-z0-9]{2,}/g) || [];
}

function frequencyMap(text) {
  const out = {};
  for (const token of tokenize(text)) {
    out[token] = (out[token] || 0) + 1;
  }
  return out;
}

async function readSeeds() {
  const raw = await fs.readFile(SEEDS_FILE, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeUrl(line))
    .filter(Boolean);
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    const contentType = res.headers.get("content-type") || "";
    if (!res.ok || !contentType.includes("text/html")) return null;

    const html = await res.text();
    return {
      url,
      html,
      fetchedAt: new Date().toISOString()
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function crawl() {
  const seeds = await readSeeds();
  if (!seeds.length) {
    throw new Error("No seed URLs found in seeds.txt");
  }

  await fs.mkdir(DATA_DIR, { recursive: true });

  const queue = seeds.map((u) => ({ url: u, depth: 0 }));
  const seen = new Set();
  const pages = [];

  while (queue.length && pages.length < MAX_PAGES) {
    const current = queue.shift();
    const url = normalizeUrl(current.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    await sleep(DELAY_MS);

    const page = await fetchPage(url);
    if (!page) continue;

    const title = extractTitle(page.html);
    const description = extractMetaDescription(page.html);
    const canonical = extractCanonical(page.html, url);
    const text = stripHtml(page.html);
    const links = extractLinks(page.html, url);

    pages.push({
      id: pages.length + 1,
      url: canonical,
      sourceUrl: url,
      host: new URL(canonical).hostname,
      title,
      description,
      text: text.slice(0, 30000),
      links,
      fetchedAt: page.fetchedAt,
      terms: {
        title: frequencyMap(title),
        description: frequencyMap(description),
        text: frequencyMap(text.slice(0, 20000))
      }
    });

    if (current.depth < MAX_DEPTH) {
      for (const link of links) {
        if (!seen.has(link)) {
          queue.push({ url: link, depth: current.depth + 1 });
        }
      }
    }

    process.stdout.write(
      `\rCrawled ${pages.length}/${MAX_PAGES} | queue ${queue.length} | last ${canonical.slice(0, 90)}   `
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    seeds,
    maxPages: MAX_PAGES,
    maxDepth: MAX_DEPTH,
    pages
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`\nSaved ${pages.length} pages to ${OUT_FILE}`);
}

crawl().catch((err) => {
  console.error("\nCrawler failed:", err.message);
  process.exit(1);
});
