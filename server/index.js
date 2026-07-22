require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const apiRoutes = require("./src/routes");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.use("/api", apiRoutes);

// Serve the frontend (built as static files) from ../public
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(publicDir, "index.html"));
});

// Central error handler - keeps scrape failures from crashing the process
app.use((err, req, res, next) => {
  console.error("[error]", err.message);
  res.status(502).json({ error: "Upstream DSE data fetch failed", detail: err.message });
});

app.listen(PORT, () => {
  console.log(`DSE tracker server running at http://localhost:${PORT}`);
});
