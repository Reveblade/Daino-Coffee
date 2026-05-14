# Daino Coffee — Authority (staff panel)

Repository: [github.com/Daino-Coffee/authority](https://github.com/Daino-Coffee/authority)

Lightweight **Vite + vanilla JS** SPA for **in-store and delivery operations**: login, then role-specific panels against the [backend API](https://github.com/Daino-Coffee/backend). Runs on a **separate origin** from the public customer site (e.g. port **5174** in dev).

---

## What it does

| Role | Capabilities in the UI |
|------|-------------------------|
| **Courier** | View current assigned order (same **WebSocket** + REST fallback as orders list); **Yola çıktım**; **Teslim + POS** / **Teslim + nakit**; delivery history |
| **Cashier / Admin** | List orders (`GET /v1/orders`) with **WebSocket** push (`/ws/orders?token=…`) for live updates, plus 8s REST fallback when WS is down; in-place & online **state transitions**; **assign courier** when online order is ready; **toggle shop “service”** (table ordering on/off) |
| **Admin only** | **Staff** list/create/delete; **Tables** list, create, QR regenerate, delete (non-system); **Menu** read-only summary |

### Login modes

1. **Personel (SMS)** — same OTP flow as customers; the phone must already exist as **ADMIN**, **CASHIER**, or **COURIER** (created from admin).
2. **Sahip** — `POST /v1/auth/owner/login` with env-configured owner phone + password → **ADMIN_OWNER** JWT.

Token is stored in **`localStorage`** under `daino_authority_token`.

---

## Requirements

- **Node.js** 20+
- Running **backend** with staff users seeded and CORS allowing this app’s origin

---

## Clone & install

```bash
git clone https://github.com/Daino-Coffee/authority.git
cd authority
npm install
cp .env.example .env   # edit VITE_API_BASE_URL
```

---

## Environment

| Variable | Example | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | `http://localhost:3000/v1` | API base **including** `/v1` |

Add **`http://localhost:5174`** (or your deployed authority URL) to backend **`CORS_ORIGINS`**.

---

## Run (development)

```bash
npm run dev
```

Open `http://localhost:5174/`.

---

## Build (production)

```bash
npm run build
```

Static output in **`dist/`** — deploy to any static host (S3 + CloudFront, Cloud Storage + LB, nginx, etc.) and set `VITE_API_BASE_URL` at **build time** for your API URL.

```bash
npm run preview   # preview dist on port 5174
```

---

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev (port 5174) |
| `npm run build` | Production bundle |
| `npm run preview` | Serve `dist` |
| `npm run lint` | ESLint |

---

## Related repositories

- [backend](https://github.com/Daino-Coffee/backend) — API this UI consumes  
- [frontend](https://github.com/Daino-Coffee/frontend) — public marketing + **customer** ordering (`customer.html`)
