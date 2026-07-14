/**
 * FoodCheck API — MongoDB-backed version
 * ---------------------------------------------------------------
 * Serves product-safety data for a scanned package ID.
 *
 * ID FORMAT:   [Company Code: 3 letters + 3 digits]
 *            + [Filler: 1 letter, ignored - obfuscation only]
 *            + [Product Code: "P" + 5 digits]
 *   e.g.  ABC001SP12345
 *
 * DATABASE:
 *   Connection string comes from the MONGODB_URI environment variable -
 *   it is NEVER hardcoded here. Set it in Render's dashboard
 *   (Environment tab) and, for local dev, in a .env file that is
 *   git-ignored (see .env.example).
 *
 *   Database: foodscan
 *   Collections:
 *     companies  -> _id = companyCode, { name, address, fssai }
 *     products   -> _id = full scanned id, { companyCode, productCode, ...details }
 * ---------------------------------------------------------------
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const app = express();
app.use(cors());

const NEAR_EXPIRY_WINDOW_DAYS = 15;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "foodscan";

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI environment variable. Set it before starting the server.");
  process.exit(1);
}

let db;

async function connectDB() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`Connected to MongoDB database "${DB_NAME}"`);
}

// ---- ID validation -------------------------------------------------
const ID_PATTERN = /^([A-Z]{3}\d{3})([A-Z])(P\d{5})$/;

function parseScanId(rawId) {
  const id = String(rawId || "").toUpperCase().trim();
  const match = ID_PATTERN.exec(id);
  if (!match) return null;
  return { fullId: id, companyCode: match[1], productCode: match[3] };
}

// ---- data access (Mongo instead of JSON files) ----------------------
async function getProductRecord(fullId) {
  return db.collection("products").findOne({ _id: fullId });
}

async function getCompanyRecord(companyCode) {
  return db.collection("companies").findOne({ _id: companyCode });
}

// ---- status logic ----------------------------------------------------
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

// ---- routes ------------------------------------------------------------

app.get("/api/products/:id", async (req, res) => {
  try {
    const parsed = parseScanId(req.params.id);
    if (!parsed) {
      return res.status(400).json({
        error: "invalid_id_format",
        message: "This code doesn't match a recognised FoodCheck product ID.",
      });
    }

    const product = await getProductRecord(parsed.fullId);
    if (!product) {
      return res.status(404).json({
        error: "product_not_found",
        message: "No product is registered under this ID.",
        id: parsed.fullId,
      });
    }

    const company = await getCompanyRecord(parsed.companyCode);
    const status = computeStatus(product.expDate);

    res.json({
      id: parsed.fullId,
      companyCode: parsed.companyCode,
      productCode: parsed.productCode,
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
      manufacturer: company
        ? { name: company.name, address: company.address, fssai: company.fssai }
        : null,
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
  .then(() => {
    app.listen(PORT, () => console.log(`FoodCheck API running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });
