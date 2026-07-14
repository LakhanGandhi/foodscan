# FoodCheck API

Resolves a scanned package ID (e.g. `ABC001SP12345`) to product safety details.

## ID format
```
[Company Code: 3 letters + 3 digits] + [Filler: 1 letter, ignored] + [Product Code: "P" + 5 digits]
ABC001                                  S                              P12345
```
The filler letter can be *any* letter — it's not checked, just there to make the code look less like an obviously structured ID. Company code and product code are the parts that matter.

## Run locally
```bash
cd api
npm install
npm start
```
Server starts on `http://localhost:3000`.

Test it:
```
GET http://localhost:3000/api/products/ABC001SP12345
GET http://localhost:3000/api/products/DEF002XP54321
GET http://localhost:3000/api/products/GHI003QP67890
```

## Deploy
This is a plain Node/Express app, so it runs on any Node host: Render, Railway, Fly.io, an EC2/VM, etc.
1. Push the `api/` folder to your host of choice.
2. Set `npm start` as the start command.
3. Once deployed, you'll have a public URL like `https://foodcheck-api.onrender.com`.
4. Open `index.html` and set:
   ```js
   const API_BASE = "https://foodcheck-api.onrender.com/api/products";
   ```

## Current data store
`data/products.json` and `data/companies.json` are placeholder files standing in for a real database — this is deliberately the next thing to swap out. The only two functions that touch them are `getProductRecord()` and `getCompanyRecord()` in `server.js`; when you're ready to move to Postgres/MongoDB/etc., those are the only two places that need to change.

## Registering a new product
Add an entry to `products.json` keyed by its full ID, referencing a `companyCode` that exists in `companies.json`. If the company is new, add it to `companies.json` first (name, address, FSSAI number) — you only need to enter that once per manufacturer, not per product.
