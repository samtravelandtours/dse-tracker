const express = require("express");
const dse = require("./dseClient");
const { withCache } = require("./cache");

const router = express.Router();

// TTLs: live price data refreshes often; index history barely changes intraday.
const TTL_LIVE = 30 * 1000; // 30s
const TTL_INFO = 5 * 60 * 1000; // 5 min
const TTL_STATUS = 60 * 1000; // 1 min
const TTL_HIST = 30 * 60 * 1000; // 30 min

// GET /api/status - is the market open right now
router.get("/status", async (req, res, next) => {
  try {
    const status = await withCache("status", TTL_STATUS, dse.fetchMarketStatus);
    res.json({ status });
  } catch (err) {
    next(err);
  }
});

// GET /api/market-info - last ~30 trading days: indices + volumes (for header + chart)
router.get("/market-info", async (req, res, next) => {
  try {
    const rows = await withCache("market-info", TTL_INFO, dse.fetchMarketInfo);
    res.json({ history: rows, latest: rows[0] || null });
  } catch (err) {
    next(err);
  }
});

// GET /api/stocks - full live list, all symbols
// GET /api/stocks?q=ACI - filter by symbol substring (case-insensitive)
router.get("/stocks", async (req, res, next) => {
  try {
    const rows = await withCache("stocks", TTL_LIVE, dse.fetchLatestShares);
    const q = (req.query.q || "").toUpperCase().trim();
    const filtered = q ? rows.filter((r) => r.symbol.toUpperCase().includes(q)) : rows;
    res.json({ count: filtered.length, stocks: filtered });
  } catch (err) {
    next(err);
  }
});

// GET /api/stocks/:symbol - single symbol's live snapshot
router.get("/stocks/:symbol", async (req, res, next) => {
  try {
    const rows = await withCache("stocks", TTL_LIVE, dse.fetchLatestShares);
    const symbol = req.params.symbol.toUpperCase();
    const stock = rows.find((r) => r.symbol.toUpperCase() === symbol);
    if (!stock) return res.status(404).json({ error: `Symbol not found: ${symbol}` });
    res.json({ stock });
  } catch (err) {
    next(err);
  }
});

// GET /api/movers/gainers?limit=10
router.get("/movers/gainers", async (req, res, next) => {
  try {
    const rows = await withCache("stocks", TTL_LIVE, dse.fetchLatestShares);
    const limit = clampLimit(req.query.limit);
    const gainers = rows
      .filter((r) => r.change != null && r.change > 0)
      .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
      .slice(0, limit);
    res.json({ gainers });
  } catch (err) {
    next(err);
  }
});

// GET /api/movers/losers?limit=10
router.get("/movers/losers", async (req, res, next) => {
  try {
    const rows = await withCache("stocks", TTL_LIVE, dse.fetchLatestShares);
    const limit = clampLimit(req.query.limit);
    const losers = rows
      .filter((r) => r.change != null && r.change < 0)
      .sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0))
      .slice(0, limit);
    res.json({ losers });
  } catch (err) {
    next(err);
  }
});

// GET /api/movers/most-traded?limit=10&by=volume|value
router.get("/movers/most-traded", async (req, res, next) => {
  try {
    const rows = await withCache("stocks", TTL_LIVE, dse.fetchLatestShares);
    const limit = clampLimit(req.query.limit);
    const by = req.query.by === "value" ? "value" : "volume";
    const mostTraded = rows
      .filter((r) => r[by] != null)
      .sort((a, b) => b[by] - a[by])
      .slice(0, limit);
    res.json({ by, mostTraded });
  } catch (err) {
    next(err);
  }
});

// GET /api/historical?code=ACI&start=2026-06-01&end=2026-07-01
router.get("/historical", async (req, res, next) => {
  try {
    const { code = "All Instrument", start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: "start and end query params are required (YYYY-MM-DD)" });
    }
    const key = `hist:${code}:${start}:${end}`;
    const rows = await withCache(key, TTL_HIST, () => dse.fetchHistorical(start, end, code));
    res.json({ code, start, end, history: rows });
  } catch (err) {
    next(err);
  }
});

function clampLimit(raw) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return 10;
  return Math.min(n, 50);
}

module.exports = router;
