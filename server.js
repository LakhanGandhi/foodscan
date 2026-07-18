/**
 * FoodCheck API — v3 (opaque IDs + company/plant separation)
 * ---------------------------------------------------------------
 * The QR code on a package encodes ONE opaque, random product ID
 * (a NanoID-style string, e.g. "Qx7mZk2LpT"). There is nothing to
 * decode in it - it's just a lookup key. All the structure lives
 * in the database instead:
 *
 *   companies  { _id, name, registeredAddress, ... }
 *   plants     { _id, companyId (ref), label, address, fssaiLicense }
 *   products   { _id, companyId (ref), plantId (ref), name, brand,
 *                batch, mfgDate, expDate, ingredients,
 *                nutritionPer100g, allergens }
 *
 * A product references BOTH companyId and plantId directly, so a
 * lookup only ever needs two extra queries (plant, company) - no
 * joins across joins.
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
  console.error("Missing MONGODB_URI environment variable.");
  process.exit(1);
}

let db;

async function connectDB() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`Connected to MongoDB database "${DB_NAME}"`);
}

// Loose sanity check only - NOT a security boundary, just filters out
// obviously junk input before hitting the database. Adjust length
// range if you change the generator.
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

    const [plant, company] = await Promise.all([
      product.plantId ? db.collection("plants").findOne({ _id: product.plantId }) : null,
      product.companyId ? db.collection("companies").findOne({ _id: product.companyId }) : null,
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
