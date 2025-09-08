# Livvitt — Custom Print Ordering (Final)

Multi‑item banners & signs configurator with instant pricing, file uploads,
and bank‑transfer checkout. Built for Netlify + Supabase.

## Features
- Products: Banner, Adhesive Vinyl (Sticker), PVC 6/9/12/15mm, Dibond 4mm, Stand Up Banner 33x80, A‑Frame (double‑sided) 24x36
- Per‑line volume discounts: 10+/25+/50+ → 5/10/15%
- Hems, grommets, pole pockets, double‑sided (for flexible media)
- Lamination (Adhesive Vinyl)
- Fixed‑size locking for Stand Up Banner and A‑Frame
- Product images (optional) — set `image` field in `src/pricing.js`
- Upload up to 5 files per line (PDF/AI/EPS/SVG/PNG/JPG) to **Supabase Storage** via signed URLs
- On order: save `orders/<ORDER_NO>/order.json` + move files to `orders/<ORDER_NO>/files/`

## Environment variables (Netlify)

Client (`VITE_` prefix):
- `VITE_SUPABASE_URL` — Supabase URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key
- `VITE_ORDERS_BUCKET` — `orders`
- `VITE_CURRENCY` — e.g. `USD` or `ANG`
- `VITE_BANK_COMPANY` — e.g. `Livvitt Plus`
- `VITE_BANK_NAME` — your bank
- `VITE_BANK_ACCOUNT` — your account/IBAN
- `VITE_BANK_SWIFT` — SWIFT/BIC

Server (Functions):
- `SUPABASE_URL` — Supabase URL
- `SUPABASE_SERVICE_ROLE_KEY` — Service Role Key
- `ORDERS_BUCKET` — `orders`

## Supabase storage

Create private bucket `orders`. Optionally add an empty placeholder `orders/tmp/.empty`.

Draft uploads go to `orders/tmp/<draftId>/…`. On placement, files are moved to `orders/<ORDER_NO>/files/…` and order JSON is saved to `orders/<ORDER_NO>/order.json`.

## Local development

```bash
npm i
npm run dev
```

## Deploy

- Push to GitHub → Netlify builds with `netlify.toml` (SPA redirect + functions)
- Ensure environment variables are set
