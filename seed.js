/**
 * One-time migration: loads your existing companies.json / products.json
 * into MongoDB Atlas. Run this once locally after setting MONGODB_URI.
 *
 * Usage:
 *   npm install
 *   node seed.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "foodscan";

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI. Set it in a .env file (see .env.example) before running this.");
  process.exit(1);
}

async function seed() {
  const companies = JSON.parse(fs.readFileSync(path.join(__dirname, "companies.json"), "utf-8"));
  const products = JSON.parse(fs.readFileSync(path.join(__dirname, "products.json"), "utf-8"));

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const companyDocs = Object.entries(companies).map(([code, data]) => ({ _id: code, ...data }));
  const productDocs = Object.entries(products).map(([id, data]) => ({ _id: id, ...data }));

  const companiesCol = db.collection("companies");
  const productsCol = db.collection("products");

  for (const doc of companyDocs) {
    await companiesCol.replaceOne({ _id: doc._id }, doc, { upsert: true });
  }
  for (const doc of productDocs) {
    await productsCol.replaceOne({ _id: doc._id }, doc, { upsert: true });
  }

  console.log(`Seeded ${companyDocs.length} companies and ${productDocs.length} products into "${DB_NAME}".`);
  await client.close();
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
