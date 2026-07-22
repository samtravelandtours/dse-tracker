const API = ""; // same origin; set to e.g. "http://localhost:4000" if serving frontend separately
const REFRESH_MS = 30000;

const state = {
  stocks: [],
  activeTab: "all",
  sortKey: "value",
  sortDir: "desc",
  search: "",
  watchlist: new Set(JSON.parse(localStorage.getItem("dseWatchlist") || "[]")),
  chart: null,
};

// ---------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------
async function fetchJSON(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function loadAll() {
  await Promise.allSettled([loadStocks(), loadStatus(), loadMarketInfo()]);
}

async function loadStocks() {
  try {
    const data = await fetchJSON("/api/stocks");
    state.stocks = data.stocks || [];
    renderTicker(state.stocks);
    renderTable();
    document.getElementById("lastUpdated").textContent =
      "Last updated " + new Date().toLocaleTimeString();
  } catch (err) {
    console.error("loadStocks failed", err);
    document.getElementById("stockTableBody").innerHTML =
      `<tr><td colspan="10" class="empty-state">Couldn't reach the market data server. It may still be starting up, or DSE's site is temporarily unreachable.</td></tr>`;
  }
}

async function loadStatus() {
  try {
    const { status } = await fetchJSON("/api/status");
    const dot = document.getElementById("statusDot");
    const label = document.getElementById("statusLabel");
    label.textContent = status;
    dot.className = "status-dot " + (/open/i.test(status) ? "open" : /closed/i.test(status) ? "closed" : "");
  } catch (err) {
    console.error("loadStatus failed", err);
  }
}

async function loadMarketInfo() {
  try {
    const { history, latest } = await fetchJSON("/api/market-info");
    if (latest) {
      setIndexChip("dsexVal", latest.dsex);
      setIndexChip("ds30Val", latest.ds30);
      setIndexChip("dsesVal", latest.dses);
      document.getElementById("snapTrades").textContent = fmtInt(latest.totalTrade);
      document.getElementById("snapVolume").textContent = fmtInt(latest.totalVolume);
      document.getElementById("snapValue").textContent = fmtNum(latest.totalValueMn);
      document.getElementById("snapCap").textContent = fmtNum(latest.totalMarketCapMn);
    }
    if (history && history.length) renderChart(history);
  } catch (err) {
    console.error("loadMarketInfo failed", err);
  }
}

function setIndexChip(id, value) {
  const el = document.getElementById(id);
  el.textContent = value != null ? fmtNum(value) : "—";
}

// ---------------------------------------------------------------------
// Ticker tape
// ---------------------------------------------------------------------
function renderTicker(stocks) {
  const track = document.getElementById("tickerTrack");
  if (!stocks.length) return;
  const sample = [...stocks].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 25);
  const itemsHtml = sample
    .map((s) => tickerItemHtml(s))
    .join("");
  // Duplicate the sequence so the 50%-translate loop is seamless.
  track.innerHTML = itemsHtml + itemsHtml;
}

function tickerItemHtml(s) {
  const dir = dirClass(s.change);
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "•";
  return `<span class="ticker-item ${dir}"><span class="sym">${s.symbol}</span> ${fmtNum(s.ltp)} ${arrow} ${fmtPct(s.changePercent)}</span>`;
}

function dirClass(change) {
  if (change == null || change === 0) return "flat";
  return change > 0 ? "up" : "down";
}

// ---------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------
function currentRows() {
  let rows;
  if (state.activeTab === "gainers") {
    rows = state.stocks.filter((r) => r.change > 0).sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0)).slice(0, 20);
  } else if (state.activeTab === "losers") {
    rows = state.stocks.filter((r) => r.change < 0).sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0)).slice(0, 20);
  } else if (state.activeTab === "traded") {
    rows = [...state.stocks].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 20);
  } else if (state.activeTab === "watchlist") {
    rows = state.stocks.filter((r) => state.watchlist.has(r.symbol));
  } else {
    rows = [...state.stocks];
  }

  if (state.search) {
    const q = state.search.toUpperCase();
    rows = rows.filter((r) => r.symbol.toUpperCase().includes(q));
  }

  if (state.activeTab === "all" || state.activeTab === "watchlist") {
    rows.sort((a, b) => {
      const av = a[state.sortKey] ?? -Infinity;
      const bv = b[state.sortKey] ?? -Infinity;
      if (typeof av === "string") return state.sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return state.sortDir === "asc" ? av - bv : bv - av;
    });
  }
  return rows;
}

function renderTable() {
  const rows = currentRows();
  const body = document.getElementById("stockTableBody");

  if (!rows.length) {
    const msg =
      state.activeTab === "watchlist"
        ? "Your watchlist is empty — click the star next to any symbol to add it."
        : "No matching stocks.";
    body.innerHTML = `<tr><td colspan="10" class="empty-state">${msg}</td></tr>`;
  } else {
    body.innerHTML = rows.map(rowHtml).join("");
  }

  document.getElementById("watchCount").textContent = state.watchlist.size || "";

  body.querySelectorAll(".watch-star").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleWatch(btn.dataset.symbol);
    });
  });
}

function rowHtml(r) {
  const dir = dirClass(r.change);
  const starred = state.watchlist.has(r.symbol) ? "active" : "";
  return `
    <tr>
      <td><button class="watch-star ${starred}" data-symbol="${r.symbol}" title="Toggle watchlist">★</button></td>
      <td class="sym">${r.symbol}</td>
      <td class="num">${fmtNum(r.ltp)}</td>
      <td class="num chg ${dir}">${fmtSigned(r.change)}</td>
      <td class="num pct ${dir}">${fmtPct(r.changePercent)}</td>
      <td class="num">${fmtNum(r.high)}</td>
      <td class="num">${fmtNum(r.low)}</td>
      <td class="num">${fmtNum(r.ycp)}</td>
      <td class="num">${fmtInt(r.volume)}</td>
      <td class="num">${fmtNum(r.value)}</td>
    </tr>`;
}

function toggleWatch(symbol) {
  if (state.watchlist.has(symbol)) state.watchlist.delete(symbol);
  else state.watchlist.add(symbol);
  localStorage.setItem("dseWatchlist", JSON.stringify([...state.watchlist]));
  renderTable();
}

// ---------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------
function renderChart(history) {
  const ordered = [...history].reverse(); // oldest -> newest for a left-to-right chart
  const ctx = document.getElementById("indexChart");
  const labels = ordered.map((h) => h.date);
  const data = ordered.map((h) => h.dsex);

  if (state.chart) {
    state.chart.data.labels = labels;
    state.chart.data.datasets[0].data = data;
    state.chart.update();
    return;
  }

  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "DSEX",
          data,
          borderColor: "#1F8A57",
          backgroundColor: "rgba(31,138,87,0.08)",
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { grid: { color: "#E4E9E2" }, ticks: { font: { family: "JetBrains Mono", size: 10 } } },
      },
    },
  });
}

// ---------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------
function fmtNum(v) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}
function fmtInt(v) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString();
}
function fmtSigned(v) {
  if (v == null || Number.isNaN(v)) return "—";
  const s = v > 0 ? "+" : "";
  return s + fmtNum(v);
}
function fmtPct(v) {
  if (v == null || Number.isNaN(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(2)}%`;
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  state.activeTab = btn.dataset.tab;
  renderTable();
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  state.search = e.target.value;
  renderTable();
});

document.getElementById("stockTable").querySelector("thead").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-sort]");
  if (!th) return;
  const key = th.dataset.sort;
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDir = "desc";
  }
  renderTable();
});

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
loadAll();
setInterval(loadAll, REFRESH_MS);
