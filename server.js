/**
 * FoodCheck API
 * ---------------------------------------------------------------
 * Serves product-safety data for a scanned package ID.
 *
 * ID FORMAT:   [Company Code: 3 letters + 3 digits]
 *            + [Filler: 1 letter, ignored - obfuscation only]
 *            + [Product Code: "P" + 5 digits]
 *
 *   e.g.  ABC001SP12345
 *          ABC001  -> company code   (registered manufacturer)
 *               S  -> filler, meaningless, purely decorative
 *          P12345  -> product code
 *
 * This file uses local JSON as a stand-in "database". Swap the
 * two readJSON() calls for real DB queries (Postgres/Mongo/etc.)
 * when you're ready - the route logic below doesn't need to change.
 * ---------------------------------------------------------------
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());

const PRODUCTS_PATH = path.join(__dirname, "data", "products.json");
const COMPANIES_PATH = path.join(__dirname, "data", "companies.json");

const NEAR_EXPIRY_WINDOW_DAYS = 15;

// ---- ID validation -------------------------------------------------
// group 1: company code (3 letters + 3 digits)
// group 2: filler letter (any single letter - ignored)
// group 3: product code (P + 5 digits)
const ID_PATTERN = /^([A-Z]{3}\d{3})([A-Z])(P\d{5})$/;

function parseScanId(rawId) {
  const id = String(rawId || "").toUpperCase().trim();
  const match = ID_PATTERN.exec(id);
  if (!match) return null;
  return {
    fullId: id,
    companyCode: match[1],
    productCode: match[3],
  };
}

// ---- data access (swap for real DB later) ---------------------------
function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function getProductRecord(fullId) {
  const products = readJSON(PRODUCTS_PATH);
  return products[fullId] || null;
}

function getCompanyRecord(companyCode) {
  const companies = readJSON(COMPANIES_PATH);
  return companies[companyCode] || null;
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

// GET /api/products/:id
app.get("/api/products/:id", (req, res) => {
  const parsed = parseScanId(req.params.id);

  if (!parsed) {
    return res.status(400).json({
      error: "invalid_id_format",
      message: "This code doesn't match a recognised FoodCheck product ID.",
    });
  }

  const product = getProductRecord(parsed.fullId);
  if (!product) {
    return res.status(404).json({
      error: "product_not_found",
      message: "No product is registered under this ID.",
      id: parsed.fullId,
    });
  }

  const company = getCompanyRecord(parsed.companyCode);
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
});

// simple health check
app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FoodCheck API running on http://localhost:${PORT}`);
});
