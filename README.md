# Daino Coffee — Backend API

Repository: [github.com/Daino-Coffee/backend](https://github.com/Daino-Coffee/backend)

NestJS **REST API** (`/v1`) for the Daino Coffee stack: **MongoDB**, **JWT** auth, **Netgsm** SMS OTP for Turkish mobiles (`+90` / `5…`), **Cloudinary** for category/product images and optional table **QR** PNGs, and full **order** workflows (in-place via table QR vs online delivery).

---

## What it does

| Area | Capability |
|------|----------------|
| **Auth** | SMS OTP (`/auth/otp/*`); owner password login (`/auth/owner/login`); JWT access tokens |
| **Users** | Roles `ADMIN_OWNER`, `ADMIN`, `CASHIER`, `COURIER`, `CUSTOMER`; customer addresses & favorites; admin staff CRUD |
| **Shop** | `serviceEnabled` flag — when off, table QR menus must not take orders (self-service); table **0** is always display-only |
| **Tables** | Opaque public slugs, menu URLs, optional Cloudinary QR image; admin CRUD + regenerate QR |
| **Menu** | Nested categories, products (price in kuruş), availability toggle; public `GET /menu` |
| **Orders** | **IN_PLACE** and **ONLINE** channels, status machines, embedded `history`, cashier assign courier, POS vs cash settlement rules |
| **Courier** | Current job, start delivery, deliver with `CASH` / `POS`, history |
| **Uploads** | `POST /admin/uploads/image` (Cloudinary) |

---

## Requirements

- **Node.js** 20+
- **MongoDB** 6+ (local, Docker, or Atlas)

---

## Clone & install

```bash
git clone https://github.com/Daino-Coffee/backend.git
cd backend
npm install
cp .env.example .env   # then edit .env
```

---

## Configure

Copy [`.env.example`](.env.example) to `.env`. Minimum:

- `MONGODB_URI`, `JWT_SECRET` (≥16 chars), `MENU_PUBLIC_BASE_URL`
- `OWNER_PHONE_E164`, `OWNER_PASSWORD` (seeds immutable **ADMIN_OWNER** on boot)
- `NETGSM_*` for production SMS, or `NETGSM_OTP_DISABLED=true` for local dev (OTP logged)
- `CLOUDINARY_*` optional (QR/menu uploads degrade gracefully if unset)

| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | Mongo connection string |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | Signing & TTL |
| `CORS_ORIGINS` | Comma-separated browser origins (e.g. Vite dev servers) or `*` |
| `MENU_PUBLIC_BASE_URL` | Base URL embedded in table QR links |
| `OWNER_*` | Owner phone (E.164 `+905…`) + password (hashed on bootstrap) |
| `NETGSM_*` | Netgsm XML SMS (`api.netgsm.com.tr`) |
| `CLOUDINARY_*` | Image uploads |

---

## Run (development)

```bash
# optional local Mongo
docker compose up -d

npm run start:dev
```

- Health: `GET http://localhost:3000/healthz` (no `/v1` prefix).
- All business routes: **`/v1/...`**.

---

## Build (production)

```bash
npm run build
npm run start:prod
```

Compiles TypeScript to `dist/` and runs `node dist/main.js`. Set `NODE_ENV=production` and a real `MONGODB_URI` / secrets in your host or container environment.

---

## API overview

- **Customers / staff (non-owner):** `POST /v1/auth/otp/request` → `POST /v1/auth/otp/verify`. First OTP on a new phone creates a **CUSTOMER**. Staff phones must exist (created by admin) before OTP sign-in.
- **Owner:** `POST /v1/auth/owner/login` — no SMS.

Phones normalize to **E.164** `+905xxxxxxxx`.

### Route map (summary)

| Area | Routes |
|------|--------|
| Health | `GET /healthz` |
| Auth | `POST /v1/auth/otp/request`, `otp/verify`, `owner/login` |
| Users | `GET /v1/users/me`, addresses, favorites |
| Admin | `GET/POST/DELETE /v1/admin/staff`, `GET /v1/admin/couriers` |
| Shop | `GET/PATCH /v1/shop/settings` |
| Tables | `GET /v1/tables/public/:slug`, admin CRUD + `regenerate-qr` |
| Menu | `GET /v1/menu`, admin categories/products CRUD |
| Uploads | `POST /v1/admin/uploads/image` |
| Orders | `POST /v1/orders/in-place`, `online`, `GET /v1/orders`, transitions, `assign-courier` |
| Courier | `GET /v1/courier/orders/current`, `history`, `start-delivery`, `deliver` |

---

## Netgsm

OTP SMS uses **XML POST** to `https://api.netgsm.com.tr/sms/send/xml`. Numbers are sent as `90xxxxxxxxx` (no `+`). Success responses are expected to start with `00` (adjust if your account differs).

---

## Tests

```bash
npm test          # unit (phone helpers)
npm run test:e2e  # MongoDB in-memory: health, owner login, shop settings
```

---

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run start:dev` | Nest watch mode |
| `npm run build` | `nest build` → `dist/` |
| `npm run start:prod` | Run compiled app |
| `npm run lint` | ESLint |

---

## Related repositories

- [frontend](https://github.com/Daino-Coffee/frontend) — marketing site + customer ordering UI
- [authority](https://github.com/Daino-Coffee/authority) — staff panel (admin / cashier / courier)
