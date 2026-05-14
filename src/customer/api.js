const TOKEN_KEY = 'daino_customer_token';

export function getApiBase() {
  const raw = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';
  return raw.replace(/\/$/, '');
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export function decodeJwt(token) {
  try {
    const p = token.split('.')[1];
    return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export async function api(path, opts = {}) {
  const url = `${getApiBase()}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (!res.ok) {
    const err = new Error(
      Array.isArray(body?.message)
        ? body.message.join(', ')
        : body?.message ?? res.statusText,
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export function formatTry(kurus) {
  return `${(kurus / 100).toFixed(2)} ₺`;
}
