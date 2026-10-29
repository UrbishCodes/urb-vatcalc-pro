# URB VATCalc Pro

A retro neobrutalist VAT workstation — two tools, one page:

- **Sales + VAT (default home)** — non-reverse (default) & reverse VAT modes
  with linked fields: the field you touch wins, everything else adjusts.
  Pcs / Dozen / Kg unit billing with per-unit absorption rules (pcs: rate
  absorbs · dozen: half-dozen grid · kg: sticky absorber), tidy-option chips
  (4.5 / 2.25 style), a receipt panel, and a per-device sales ledger.
- **URB-991ES PLUS (side calculator)** — fx-class shop calculator with
  +VAT / −VAT / VAT AMT / VAT SPLIT business keys, live preview before `=`,
  persistent per-device history, a distinct sound per key, and optional
  fast narration.

Everything is client-side (localStorage per device — no interlap between
devices, no cloud, no tracking). One shared VAT rate everywhere.

## Run locally

```bash
npm install     # or: bun install
npm run dev     # http://localhost:3000
```

## Build & deploy

```bash
npm run build            # static export → ./out  (no server needed anywhere)
```

See **DEPLOY.md** for the full Vercel / Cloudflare Workers / GitHub sheet.

- Vercel: import the repo, defaults just work (`output: "export"`).
- Cloudflare Workers: `npx wrangler login && npm run deploy:workers`
  (uses `wrangler.toml`, serves `./out` as static assets).
