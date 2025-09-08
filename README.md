# Livvitt — Custom Print Ordering (Final)

Multi‑item banners & signs configurator with instant pricing, file uploads, and bank‑transfer checkout.  
Front‑end: React (Vite). Backend: Netlify Functions. Storage: Supabase (bucket `orders`).

## Products
- Banner
- Adhesive Vinyl (Sticker)
- PVC 6/9/12/15mm
- Dibond 4mm
- Stand Up Banner 33"x80" (fixed size)
- A‑Frame 24"x36" (double‑sided, White/Black)
- Volume discounts 10/25/50+ → 5/10/15%

## Env vars
Client (`VITE_*`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ORDERS_BUCKET=orders`, `VITE_CURRENCY`, `VITE_BANK_COMPANY`, `VITE_BANK_NAME`, `VITE_BANK_ACCOUNT`, `VITE_BANK_SWIFT`  
Server: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORDERS_BUCKET=orders`

## Storage paths
- Draft uploads: `orders/tmp/<draftId>/…`
- On place: `orders/<ORDER_NO>/files/…`
- Order JSON: `orders/<ORDER_NO>/order.json`

## Run
```bash
npm i
npm run dev
