# Daino Coffee — Frontend

Repository: [github.com/Daino-Coffee/frontend](https://github.com/Daino-Coffee/frontend)

**Vite** static site: **marketing landing page** (`index.html`) plus a separate **customer ordering** mini-app (`customer.html`) that talks to the [backend API](https://github.com/Daino-Coffee/backend).

---

## What it includes

| Piece | Description |
|--------|-------------|
| **Marketing site** | Hero, coffee grid, mission/roast sections (`index.html`, `src/main.js`, `src/style.css`) |
| **Customer app** | Menu, shop/service banner, table QR flow (`#/masa/:slug` or `?t=`), cart, SMS OTP login, addresses, in-place vs online checkout (`customer.html`, `src/customer/*`) |
| **Build** | Multi-page Vite output: `index.html` + `customer.html` + hashed assets |
| **Docker / Cloud Run** | `Dockerfile` + `docker/default.conf.template` (nginx; `${PORT}` for Cloud Run; **`/t/{slug}`** → `/siparis/masa/{slug}`) |
| **Compose** | `compose.yaml` for local nginx image (optional) |

---

## Requirements

- **Node.js** 20+
- **pnpm** 10+ (see `package.json` → `packageManager`)

---

## Clone & install

```bash
git clone https://github.com/Daino-Coffee/frontend.git
cd frontend
pnpm install
```

---

## Environment

Copy [`.env.example`](.env.example) to `.env` (optional for local dev):

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE_URL` | API root **including** `/v1`, e.g. `http://localhost:3000/v1` |

Vite injects `import.meta.env.VITE_*` at build time.

---

## Run (development)

```bash
pnpm dev
```

- Marketing: `http://localhost:5173/`
- Customer: `http://localhost:5173/customer.html#/`  
- Table QR (dev): `http://localhost:5173/customer.html#/masa/<publicSlug>` (slug from backend **Tables** admin)

Ensure the backend allows this origin in **`CORS_ORIGINS`**.

---

## Build (production)

```bash
pnpm run build
```

Output: `dist/` with `index.html`, `customer.html`, and `assets/`.

```bash
pnpm run preview   # local preview of dist
```

---

## Docker image

```bash
docker build -t daino-frontend .
```

Runtime listens on **8080** (nginx). For Cloud Build / Cloud Run, see [`cloudbuild.yaml`](cloudbuild.yaml).

---

## QR menu URLs

Backend stores menu URLs as `{MENU_PUBLIC_BASE_URL}/t/{slug}`. The bundled **nginx** config redirects **`/t/{slug}`** to **`/customer.html#/masa/{slug}`** so printed QRs work on the same host as the static site.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm dev` | Vite dev server |
| `pnpm run build` | Production build |
| `pnpm run preview` | Preview `dist` |
| `pnpm run lint` | ESLint `src/` |
| `pnpm run sync:assets` | Asset sync script (`scripts/sync-assets.cjs`) |

---

## Related repositories

- [backend](https://github.com/Daino-Coffee/backend) — NestJS API
- [authority](https://github.com/Daino-Coffee/authority) — Staff operations panel
