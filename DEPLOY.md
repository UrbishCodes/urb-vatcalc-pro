# URB VATCalc Pro — Deployment Sheet

**Read this fully before touching anything.** This sheet is written for an
autonomous agent that controls the user's browser and computer. The goal:
deploy this app to **Vercel** and **Cloudflare Workers** (GitHub optional but
recommended) **without any help from the user**.

The app is 100% client-side: **no database, no API routes, no environment
variables, no secrets, no server code.** One build command emits the whole
site into `out/`. That is all any host needs.

---

## 0. What you have

| Artifact | What it is | Use it for |
|---|---|---|
| `urb-vatcalc-src.zip` | Full source repo (this folder minus build junk) | GitHub, Vercel, Workers-from-source |
| `urb-vatcalc-static.zip` | **Prebuilt** site (`index.html` + assets) + its own `wrangler.toml` | Fastest Cloudflare deploy, drag-drop hosts |
| repo folder itself | same as src zip | if you already have the checkout |

Build from source (only if using the src zip):

```bash
cd <repo-root>            # the folder that contains package.json
npm install               # or: bun install  (much faster; bun.lock is included)
npm run build             # emits the static site into ./out
npx serve@latest out      # local preview → http://localhost:3000
```

Requirements: Node 18+ (check `node -v`). That's it.

---

## 1. GitHub (recommended first — makes Vercel one-click)

**CLI path** (if `gh` is authenticated — check with `gh auth status`):

```bash
cd <repo-root>
git init -b main
git add -A
git commit -m "URB VATCalc Pro — sales VAT calc + URB-991ES PLUS calculator"
gh repo create urb-vatcalc-pro --public --source=. --remote=origin --push
```

**Browser path** (no CLI): github.com → click **New repository** → name
`urb-vatcalc-pro` → Public → Create → on the empty-repo page click
**"uploading an existing file"** → drag the CONTENTS of the repo folder
(all files and folders, not the folder itself) → **Commit changes**.

If the user's browser has no GitHub session, pause and ask the user to log in
once — this is the only place a login may be needed.

---

## 2. Vercel

**Path A — import from GitHub (recommended, auto-redeploys on every push):**

1. vercel.com (log in — GitHub login is fastest if the session exists)
2. **Add New… → Project**
3. **Import** the `urb-vatcalc-pro` repository
4. Framework Preset: **Next.js** (auto-detected). Leave Build Command,
   Output Directory, and Install Command **untouched** — the repo's
   `next.config.ts` already sets `output: "export"`, which Vercel honors
   automatically.
5. Click **Deploy** (~1–2 min). Copy the `https://urb-vatcalc-pro.vercel.app`
   URL.
6. Optional custom domain: Project → Settings → Domains.

**Path B — CLI (no GitHub needed):**

```bash
npm i -g vercel
vercel login                # opens the browser; complete the login
cd <repo-root>
vercel --prod               # answers: scope → your team · link project → N
                            #          project name → urb-vatcalc-pro · directory → ./
```

If Vercel's wizard asks for an output directory (only if the preset was
"Other"), answer **`out`**.

---

## 3. Cloudflare Workers

**Path A — from the prebuilt static zip (fastest, no Node build):**

```bash
unzip urb-vatcalc-static.zip -d urb-vatcalc-static
cd urb-vatcalc-static              # contains index.html + wrangler.toml (directory = ".")
npx wrangler@latest login          # opens browser OAuth → allow
npx wrangler@latest deploy         # prints: https://urb-vatcalc-pro.<subdomain>.workers.dev
```

**Path B — from source:**

```bash
cd <repo-root>
npx wrangler@latest login
npm run deploy:workers             # = next build + wrangler deploy (uses ./out)
```

**Path C — dashboard only (no CLI at all):**

1. dash.cloudflare.com → **Workers & Pages** → **Create application**
2. **Pages** tab → **Upload assets** (Direct Upload)
3. Drag the **unzipped static folder** (the one containing `index.html`)
4. **Deploy** → get the `*.pages.dev` URL.
   (Pages is Cloudflare's static host — same result, different URL shape.
   Prefer Paths A/B if the user specifically wants a *Workers* URL.)

**If the workers.dev URL returns 404:** dash → Workers & Pages →
`urb-vatcalc-pro` → **Settings → Domains & Routes** → enable the
**workers.dev** route → retry.

---

## 4. Post-deploy verification checklist

Open the deployed URL and check:

- [ ] Opens on **SALES** view, **NON-REVERSE** mode active (default)
- [ ] **The fixed bug:** PCS mode — type a rate (e.g. 45) with qty 4 → the
      base follows to 180 and **the typed rate never reverts**; type a qty →
      the amounts follow; type the base (200) → the rate absorbs to 50
- [ ] Tidy chips appear after auto-adjust (e.g. "5 pcs · rate 40") and apply
      on click, keeping the base
- [ ] KG: base 1000 + rate 7 → qty solves (≈142.857); touch qty then edit the
      base → the **rate** absorbs instead (sticky)
- [ ] DOZEN: qty snaps to half-dozen steps (1.3 → 1.5); base 90 → rate 60
- [ ] REVERSE mode: type incl.-VAT total 226 → base 200 at 13%
- [ ] Side button opens the **URB-991ES PLUS** calculator: type `5 + 5` →
      live preview `10` before pressing `=`; `=` saves to history
- [ ] `+VAT` key: 100 → 113 at 13%; the VAT rate is shared with the sales view
- [ ] Reload → histories persist (per-device localStorage)
- [ ] Phone: pinch-zoom disabled, page fits the viewport

## 5. Updating later

- **Vercel (GitHub path):** edit files → `git add -A && git commit -m "…" && git push` → auto-redeploys.
- **Vercel (CLI path):** `vercel --prod` again.
- **Workers:** `npm run deploy:workers` (or re-run Path A from a fresh static zip).
- **Pages (drag-drop):** drag the new folder again.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `wrangler` errors about assets | Use `npx wrangler@latest deploy` (old cached versions lack Static Assets) |
| `npm install` slow/fails | Use `bun install` (bun.lock included) |
| Vercel preset asked for Output Directory | Answer `out` |
| workers.dev 404 | Enable the workers.dev route (see §3) |
| Fonts look plain | Google Fonts CDN is blocked/slow on the visitor's network — the app falls back gracefully; not a deployment issue |
| Sounds don't play before first click | Browser autoplay policy — the app unlocks audio on the first tap by design |

**Never** ask the user for API keys, database URLs, or env vars — there are
none. The only interactive step that may need the user is a website login
(GitHub / Vercel / Cloudflare) if no browser session exists.
