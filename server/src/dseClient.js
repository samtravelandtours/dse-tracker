/**
 * dseClient.js
 * ------------
 * Scrapes live & historical data from the Dhaka Stock Exchange's public
 * website (dsebd.org). There is no official public API, so this mirrors the
 * page/table structure used by the well-established `bdshare` Python
 * scraper: same endpoints, same table classes, same column order. If DSE
 * changes their markup, that project (https://github.com/rochi88/bdshare)
 * is the best place to check for updated selectors.
 *
 * Every exported function returns plain JS objects/arrays — no caching here,
 * that's handled by routes.js via cache.js.
 */

const axios = require("axios");
const cheerio = require("cheerio");
const https = require("https");

const DSE_URL = "https://dsebd.org/";
const DSE_ALT_URL = "https://dse.com.bd/"; // fallback mirror, same markup

const PATHS = {
  latestShare: "latest_share_price_scroll_l.php",
  marketInfo: "recent_market_information.php",
  topGainers: "top_ten_gainer.php",
  topTwenty: "top_20_share.php",
  dayEndArchive: "day_end_archive.php",
};

// dsebd.org's TLS chain is occasionally missing an intermediate cert on some
// CA bundles. Set DSE_TLS_INSECURE=true in .env ONLY as a last resort if you
// hit self-signed/unable-to-verify errors and can't fix your system CA store.
const insecureTls = process.env.DSE_TLS_INSECURE === "true";
const httpsAgent = new https.Agent({ rejectUnauthorized: !insecureTls });

const client = axios.create({
  timeout: 15000,
  httpsAgent,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
  validateStatus: (s) => s === 200,
});

/**
 * GET a path with retries, trying the primary host then the alt host,
 * exponential-backing off between attempts (mirrors bdshare's safe_get).
 */
async function getWithFallback(path, { params, retries = 3, pause = 300 } = {}) {
  const urls = [DSE_URL + path, DSE_ALT_URL + path];
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt) await sleep(pause * 2 ** (attempt - 1));
    for (const url of urls) {
      try {
        const res = await client.get(url, { params });
        return res.data;
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw new Error(
    `Failed to fetch ${path} after ${retries} attempts (tried ${urls.join(", ")}): ${lastErr?.message}`
  );
}

async function postWithFallback(path, data, { retries = 3, pause = 300 } = {}) {
  const urls = [DSE_URL + path, DSE_ALT_URL + path];
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt) await sleep(pause * 2 ** (attempt - 1));
    for (const url of urls) {
      try {
        const res = await client.post(url, new URLSearchParams(data));
        return res.data;
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw new Error(`Failed to POST ${path}: ${lastErr?.message}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Strip thousands separators / dashes and parse a number; null if unparsable. */
function num(text, isInt = false) {
  if (text == null) return null;
  const cleaned = String(text)
    .replace(/,/g, "")
    .replace(/--/g, "")
    .trim()
    .replace(/^-$/, "");
  if (cleaned === "" || /^(n\/a|nan)$/i.test(cleaned)) return null;
  const val = isInt ? parseInt(cleaned, 10) : parseFloat(cleaned);
  return Number.isNaN(val) ? null : val;
}

const TRADE_TABLE_SELECTOR = "table.shares-table";

/** Parse the standard 11-column DSE trade row table into objects. */
function parseTradeRows(html, tableSelector = TRADE_TABLE_SELECTOR) {
  const $ = cheerio.load(html);
  const table = $(tableSelector).first();
  const rows = [];
  table.find("tr").each((i, tr) => {
    if (i === 0) return; // header row
    const cols = $(tr).find("td");
    if (cols.length < 11) return;
    const cell = (idx) => $(cols[idx]).text().trim();
    rows.push({
      symbol: cell(1),
      ltp: num(cell(2)),
      high: num(cell(3)),
      low: num(cell(4)),
      close: num(cell(5)),
      ycp: num(cell(6)),
      change: num(cell(7)),
      trade: num(cell(8), true),
      value: num(cell(9)),
      volume: num(cell(10), true),
    });
  });
  return rows;
}

/**
 * Live trade data for every listed symbol: LTP, high/low, change, volume, etc.
 * This single dataset is also used to derive gainers/losers/most-traded so
 * we don't need extra scrapes for those.
 */
async function fetchLatestShares() {
  const html = await getWithFallback(PATHS.latestShare);
  const rows = parseTradeRows(html);
  if (!rows.length) throw new Error("No trade rows parsed from latest_share_price_scroll_l.php");
  return rows.map((r) => ({
    ...r,
    changePercent:
      r.ycp && r.ycp !== 0 && r.change != null ? +((r.change / r.ycp) * 100).toFixed(2) : null,
  }));
}

/**
 * Last ~30 trading days of market-wide summary: total trades/volume/value,
 * market cap, and the four DSE indices (DSEX, DSES, DS30, DGEN).
 * Doubles as both "today's index snapshot" (last row) and chart history.
 */
async function fetchMarketInfo() {
  const html = await getWithFallback(PATHS.marketInfo);
  const $ = cheerio.load(html);
  const table = $("table#data-table").first();
  const rows = [];
  table.find("tr").each((i, tr) => {
    if (i === 0) return;
    const cols = $(tr).find("td");
    if (cols.length < 9) return;
    const cell = (idx) => $(cols[idx]).text().trim();
    rows.push({
      date: cell(0),
      totalTrade: num(cell(1), true),
      totalVolume: num(cell(2), true),
      totalValueMn: num(cell(3)),
      totalMarketCapMn: num(cell(4)),
      dsex: num(cell(5)),
      dses: num(cell(6)),
      ds30: num(cell(7)),
      dgen: num(cell(8)),
    });
  });
  if (!rows.length) throw new Error("No rows parsed from recent_market_information.php");
  return rows;
}

/** Current market status string, e.g. "Open", "Closed". */
async function fetchMarketStatus() {
  const html = await getWithFallback("");
  const $ = cheerio.load(html);
  let status = null;
  $(".HeaderTop, .HeaderTopMobile").each((_, header) => {
    if (status) return;
    $(header)
      .find("span.time")
      .each((_, span) => {
        if (status) return;
        const text = $(span).text();
        if (text.includes("Market Status")) {
          const inner = $(span).find("span.green, b").first().text().trim();
          if (inner) status = inner;
        }
      });
  });
  return status || "Unknown";
}

/** Top 10 gainers scraped directly from DSE's own ranking page. */
async function fetchTopGainersPage() {
  const html = await getWithFallback(PATHS.topGainers);
  const $ = cheerio.load(html);
  const table = $(TRADE_TABLE_SELECTOR).first();
  const rows = [];
  table.find("tr").each((i, tr) => {
    if (i === 0) return;
    const cols = $(tr).find("td");
    if (cols.length < 6) return;
    const cell = (idx) => $(cols[idx]).text().trim();
    rows.push({
      symbol: cell(1),
      close: num(cell(2)),
      high: num(cell(3)),
      low: num(cell(4)),
      ycp: num(cell(5)),
      change: num(cell(6)),
    });
  });
  return rows;
}

/** Top 20 shares by volume, scraped directly from DSE's own ranking page. */
async function fetchTopTwentyPage() {
  const html = await getWithFallback(PATHS.topTwenty);
  const $ = cheerio.load(html);
  const table = $(TRADE_TABLE_SELECTOR).first();
  const rows = [];
  table.find("tr").each((i, tr) => {
    if (i === 0) return;
    const cols = $(tr).find("td");
    if (cols.length < 7) return;
    const cell = (idx) => $(cols[idx]).text().trim();
    rows.push({
      symbol: cell(1),
      ltp: num(cell(2)),
      high: num(cell(3)),
      low: num(cell(4)),
      ycp: num(cell(5)),
      trade: num(cell(6), true),
      volume: num(cell(7), true),
    });
  });
  return rows;
}

/**
 * Historical day-end OHLCV for one symbol (or "All Instrument") between two
 * dates ('YYYY-MM-DD'). Used for the per-stock detail chart.
 */
async function fetchHistorical(start, end, code = "All Instrument") {
  const html = await postAndGetArchive(start, end, code);
  const $ = cheerio.load(html);
  const table = $("table.fixedHeader, " + TRADE_TABLE_SELECTOR).first();
  const rows = [];
  table.find("tr").each((i, tr) => {
    if (i === 0) return;
    const cols = $(tr).find("td");
    if (cols.length < 12) return;
    const cell = (idx) => $(cols[idx]).text().trim();
    rows.push({
      date: cell(1),
      symbol: cell(2),
      ltp: num(cell(3)),
      high: num(cell(4)),
      low: num(cell(5)),
      open: num(cell(6)),
      close: num(cell(7)),
      ycp: num(cell(8)),
      trade: num(cell(9), true),
      value: num(cell(10)),
      volume: num(cell(11), true),
    });
  });
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function postAndGetArchive(start, end, code) {
  // day_end_archive.php responds to a GET with query params, matching bdshare.
  return getWithFallback(PATHS.dayEndArchive, {
    params: { startDate: start, endDate: end, inst: code, archive: "data" },
  });
}

module.exports = {
  fetchLatestShares,
  fetchMarketInfo,
  fetchMarketStatus,
  fetchTopGainersPage,
  fetchTopTwentyPage,
  fetchHistorical,
};
