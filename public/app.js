
const SETTINGS_KEY = "nova-manual-search-settings-v1";
const HISTORY_KEY = "nova-manual-search-history-v1";

const DEFAULT_SETTINGS = {
  apiBase: "http://localhost:3000/api/search",
  resultsPerPage: 10,
  blockedDomains: "",
  rememberHistory: true,
  hideBlocked: true
};

const $ = (id) => document.getElementById(id);

const ui = {
  form: $("searchForm"),
  input: $("searchInput"),
  results: $("results"),
  status: $("status"),
  stats: $("stats"),
  pageLabel: $("pageLabel"),
  prevPage: $("prevPage"),
  nextPage: $("nextPage"),
  settingsBtn: $("settingsBtn"),
  overlay: $("overlay"),
  closeSettings: $("closeSettings"),
  saveBtn: $("saveBtn"),
  resetBtn: $("resetBtn"),
  apiBase: $("apiBase"),
  resultsPerPage: $("resultsPerPage"),
  blockedDomains: $("blockedDomains"),
  rememberHistory: $("rememberHistory"),
  hideBlocked: $("hideBlocked"),
  historyWrap: $("historyWrap"),
  historyList: $("historyList")
};

let settings = loadSettings();
let history = loadHistory();

let state = {
  query: "",
  page: 1,
  total: 0,
  hasMore: false
};

hydrateSettings();
renderHistory();
refreshStats();

ui.form.addEventListener("submit", (e) => {
  e.preventDefault();
  search(ui.input.value.trim(), 1);
});

ui.prevPage.addEventListener("click", () => {
  if (state.page > 1) search(state.query, state.page - 1);
});

ui.nextPage.addEventListener("click", () => {
  if (state.hasMore) search(state.query, state.page + 1);
});

ui.settingsBtn.addEventListener("click", openSettings);
ui.closeSettings.addEventListener("click", closeSettings);
ui.overlay.addEventListener("click", (e) => {
  if (e.target === ui.overlay) closeSettings();
});

ui.saveBtn.addEventListener("click", () => {
  saveSettingsFromUI();
  closeSettings();
  refreshStats();
});

ui.resetBtn.addEventListener("click", () => {
  settings = structuredClone(DEFAULT_SETTINGS);
  saveSettings();
  hydrateSettings();
  setStatus("Reset complete");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSettings();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openSettings();
  }
});

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...structuredClone(DEFAULT_SETTINGS), ...JSON.parse(raw) } : structuredClone(DEFAULT_SETTINGS);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 12)));
}

function hydrateSettings() {
  ui.apiBase.value = settings.apiBase || DEFAULT_SETTINGS.apiBase;
  ui.resultsPerPage.value = settings.resultsPerPage || 10;
  ui.blockedDomains.value = settings.blockedDomains || "";
  ui.rememberHistory.checked = !!settings.rememberHistory;
  ui.hideBlocked.checked = !!settings.hideBlocked;
}

function saveSettingsFromUI() {
  settings = {
    apiBase: ui.apiBase.value.trim() || DEFAULT_SETTINGS.apiBase,
    resultsPerPage: clampInt(ui.resultsPerPage.value, 1, 50, 10),
    blockedDomains: ui.blockedDomains.value,
    rememberHistory: ui.rememberHistory.checked,
    hideBlocked: ui.hideBlocked.checked
  };
  saveSettings();
  setStatus("Settings saved");
  renderHistory();
}

function openSettings() {
  hydrateSettings();
  ui.overlay.classList.remove("hidden");
  ui.overlay.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  ui.overlay.classList.add("hidden");
  ui.overlay.setAttribute("aria-hidden", "true");
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function setStatus(text) {
  ui.status.textContent = text;
}

function setResults(html) {
  ui.results.innerHTML = html;
}

async function refreshStats() {
  try {
    const base = new URL(settings.apiBase);
    base.pathname = "/api/stats";
    base.search = "";
    const res = await fetch(base);
    const data = await res.json();
    ui.stats.textContent = `${data.pages || 0} crawled pages`;
  } catch {
    ui.stats.textContent = "Backend offline";
  }
}

async function search(query, page) {
  query = query.trim();
  if (!query) {
    setStatus("Type something to search");
    return;
  }

  state.query = query;
  state.page = page;
  setStatus("Searching…");
  ui.pageLabel.textContent = `Page ${page}`;
  ui.prevPage.disabled = true;
  ui.nextPage.disabled = true;
  setResults(`
    <article class="card">
      <h3>Searching…</h3>
      <p class="snippet">Fetching your indexed pages.</p>
    </article>
  `);

  try {
    const url = new URL(settings.apiBase);
    url.searchParams.set("q", query);
    url.searchParams.set("page", String(page));
    url.searchParams.set("size", String(settings.resultsPerPage || 10));
    if (settings.hideBlocked && settings.blockedDomains) {
      url.searchParams.set("blocked", settings.blockedDomains);
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];

    state.total = data.total || 0;
    state.hasMore = !!data.hasMore;

    ui.prevPage.disabled = page <= 1;
    ui.nextPage.disabled = !state.hasMore;
    ui.pageLabel.textContent = `Page ${page} of ${Math.max(1, Math.ceil(state.total / (settings.resultsPerPage || 10)))}`;

    if (!results.length) {
      setResults(`
        <article class="card">
          <h3>No results</h3>
          <p class="snippet">Try a different query or crawl more pages.</p>
        </article>
      `);
      setStatus("No results");
      return;
    }

    setResults(results.map(renderCard).join(""));
    setStatus(`Found ${state.total} results`);

    if (settings.rememberHistory) {
      addHistory(query);
    }
    renderHistory();
  } catch (err) {
    console.error(err);
    setResults(`
      <article class="card">
        <h3>Search failed</h3>
        <p class="snippet">${escapeHtml(err.message || "Unknown error")}</p>
      </article>
    `);
    setStatus("Search failed");
  }
}

function renderCard(item) {
  const title = escapeHtml(item.title || item.url || "Untitled");
  const url = escapeHtml(item.url || "#");
  const host = escapeHtml(item.host || "");
  const snippet = escapeHtml(item.snippet || item.description || "");
  const score = escapeHtml(String(item.score ?? ""));
  const when = item.fetchedAt ? new Date(item.fetchedAt).toLocaleString() : "";

  return `
    <article class="card">
      <h3><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
      <div class="domain">${host}</div>
      ${snippet ? `<p class="snippet">${snippet}</p>` : ""}
      <div class="card-foot">
        ${when ? `<span class="tag">${escapeHtml(when)}</span>` : ""}
        ${score ? `<span class="tag">score ${score}</span>` : ""}
        <div class="link-row">
          <button class="link-btn" data-copy="${url}">Copy link</button>
          <a class="link-btn" href="${url}" target="_blank" rel="noopener noreferrer">Open</a>
        </div>
      </div>
    </article>
  `;
}

function addHistory(q) {
  history = [q, ...history.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 12);
  saveHistory();
}

function renderHistory() {
  if (!settings.rememberHistory || !history.length) {
    ui.historyWrap.classList.add("hidden");
    ui.historyList.innerHTML = "";
    return;
  }

  ui.historyWrap.classList.remove("hidden");
  ui.historyList.innerHTML = history
    .map((q) => `<button class="chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
    .join("");

  ui.historyList.querySelectorAll("[data-q]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ui.input.value = btn.getAttribute("data-q");
      search(ui.input.value, 1);
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-copy]");
  if (!btn) return;

  const text = btn.getAttribute("data-copy");
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = "Copy link"), 900);
  } catch {
    setStatus("Clipboard blocked by browser");
  }
});
