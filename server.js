/**
 * FoodCheck API — v4 (adds scan logging + counterfeit-spread detection)
 * ---------------------------------------------------------------
 * Same product/plant/company model as before. New addition: every
 * successful scan is logged (hashed IP + city/region/country derived
 * from that IP - never GPS, never a permission prompt). If the same
 * product ID has been scanned from several distinct locations in a
 * short window, the response carries a soft "scanFlag" the frontend
 * can show as a caution banner - a signal to look into, not a verdict.
 *
 * Privacy notes:
 *   - IPs are hashed (SHA-256 + salt) before being stored - never kept raw.
 *   - Only city/region/country are stored, never precise coordinates.
 *   - Scan logs auto-expire after 90 days via a Mongo TTL index.
 * ---------------------------------------------------------------
 */

require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const app = express();
app.use(cors());
app.set("trust proxy", true); // Render sits behind a proxy; needed to read the real client IP

const NEAR_EXPIRY_WINDOW_DAYS = 15;
const SCAN_LOG_RETENTION_DAYS = 90;
const SUSPICIOUS_DISTINCT_LOCATIONS = 3; // flag if scanned from >= this many distinct cities
const SUSPICIOUS_WINDOW_DAYS = 3; // within this many days

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "foodscan";
const IP_HASH_SALT = process.env.IP_HASH_SALT || "change-this-salt";

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI environment variable.");
  process.exit(1);
}

let db;

async function connectDB() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`Connected to MongoDB database "${DB_NAME}"`);

  // Auto-expire scan logs after SCAN_LOG_RETENTION_DAYS - keeps the
  // privacy footprint small without needing manual cleanup.
  await db.collection("scans").createIndex(
    { ts: 1 },
    { expireAfterSeconds: SCAN_LOG_RETENTION_DAYS * 86400 }
  );
}

const ID_SHAPE = /^[A-Z0-9]{6,14}$/i;

function computeStatus(expDateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expDateStr);
  const daysLeft = Math.round((exp - today) / 86400000);

  if (daysLeft < 0) {
    return { key: "danger", label: "Expired", sub: `Expired ${Math.abs(daysLeft)} day(s) ago` };
  }
  if (daysLeft <= NEAR_EXPIRY_WINDOW_DAYS) {
    return { key: "warn", label: "Near Expiry", sub: `${daysLeft} day(s) left` };
  }
  return { key: "safe", label: "Safe to Consume", sub: `${daysLeft} day(s) left` };
}

// ---- IP handling -------------------------------------------------
function getClientIp(req) {
  // req.ip already respects "trust proxy" + X-Forwarded-For
  return req.ip || req.socket.remoteAddress || "";
}

function hashIp(ip) {
  return crypto.createHash("sha256").update(IP_HASH_SALT + ip).digest("hex");
}

async function lookupGeo(ip) {
  // Skip geolocation for local/private addresses (dev environment)
  if (!ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("::ffff:127.")) {
    return { city: "Local", region: "Local", country: "Local" };
  }
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city`);
    const data = await res.json();
    if (data.status !== "success") return { city: "Unknown", region: "Unknown", country: "Unknown" };
    return { city: data.city || "Unknown", region: data.regionName || "Unknown", country: data.country || "Unknown" };
  } catch (err) {
    return { city: "Unknown", region: "Unknown", country: "Unknown" };
  }
}

// ---- scan logging + fraud heuristic ----------------------------------
async function logScanAndCheckFraud(productId, req) {
  const ip = getClientIp(req);
  const geo = await lookupGeo(ip);
  const scanDoc = {
    productId,
    ts: new Date(),
    ipHash: hashIp(ip),
    city: geo.city,
    region: geo.region,
    country: geo.country,
  };

  await db.collection("scans").insertOne(scanDoc);

  const since = new Date(Date.now() - SUSPICIOUS_WINDOW_DAYS * 86400000);
  const recentScans = await db
    .collection("scans")
    .find({ productId, ts: { $gte: since } })
    .project({ city: 1, region: 1, country: 1 })
    .toArray();

  const distinctLocations = new Set(
    recentScans
      .filter((s) => s.city !== "Local" && s.city !== "Unknown")
      .map((s) => `${s.city}|${s.region}|${s.country}`)
  );

  return {
    suspicious: distinctLocations.size >= SUSPICIOUS_DISTINCT_LOCATIONS,
    distinctLocations: distinctLocations.size,
    windowDays: SUSPICIOUS_WINDOW_DAYS,
  };
}

// ---- routes ------------------------------------------------------------

app.get("/api/products/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    if (!ID_SHAPE.test(id)) {
      return res.status(400).json({
        error: "invalid_id_format",
        message: "This code doesn't look like a valid FoodCheck product ID.",
      });
    }

    const product = await db.collection("products").findOne({ _id: id });
    if (!product) {
      return res.status(404).json({
        error: "product_not_found",
        message: "No product is registered under this ID.",
        id,
      });
    }

    const [plant, company, scanFlag] = await Promise.all([
      product.plantId ? db.collection("plants").findOne({ _id: product.plantId }) : null,
      product.companyId ? db.collection("companies").findOne({ _id: product.companyId }) : null,
      logScanAndCheckFraud(id, req),
    ]);

    const status = computeStatus(product.expDate);

    res.json({
      id: product._id,
      name: product.name,
      brand: product.brand,
      icon: product.icon,
      batch: product.batch,
      mfgDate: product.mfgDate,
      expDate: product.expDate,
      status,
      ingredients: product.ingredients,
      nutritionPer100g: product.nutritionPer100g,
      allergens: product.allergens,
      company: company ? { name: company.name, registeredAddress: company.registeredAddress } : null,
      plant: plant
        ? { label: plant.label, address: plant.address, fssaiLicense: plant.fssaiLicense }
        : null,
      scanFlag,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Something went wrong looking this up." });
  }
});

app.get("/api/health", async (req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ ok: true, db: "connected" });
  } catch (err) {
    res.status(500).json({ ok: false, db: "disconnected" });
  }
});

const PORT = process.env.PORT || 3000;

connectDB()
  .then(() => app.listen(PORT, () => console.log(`FoodCheck API running on port ${PORT}`)))
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });
