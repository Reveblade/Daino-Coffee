const TOKEN_KEY = 'daino_customer_token';
const REFRESH_KEY = 'daino_customer_refresh';

let refreshPromise = null;

export function getApiBase() {
  const raw = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';
  return raw.replace(/\/$/, '');
}

/**
 * @param {string} url
 * @param {RequestInit} opts
 * @returns {Promise<Response>}
 */
async function fetchWithNetworkHint(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (err) {
    const base = getApiBase();
    const pageOrigin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : '';
    const msg = [
      'Sunucuya ulaşılamadı (Failed to fetch).',
      `İstek: ${url}`,
      `VITE_API_BASE_URL: ${base}`,
      pageOrigin
        ? `Sayfa: ${pageOrigin} — backend CORS_ORIGINS bu adresi içermeli (localhost ile 127.0.0.1 aynı değildir).`
        : '',
      'Backend çalışıyor mu? (örn. cd backend && npm run start:dev, PORT=3000)',
    ]
      .filter(Boolean)
      .join(' ');
    const e = new Error(msg);
    e.cause = err;
    throw e;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}

/** @param {string | null} accessToken @param {string} [refreshToken] */
export function setToken(accessToken, refreshToken) {
  if (accessToken) {
    localStorage.setItem(TOKEN_KEY, accessToken);
    if (refreshToken) {
      localStorage.setItem(REFRESH_KEY, refreshToken);
    }
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }
}

export function decodeJwt(token) {
  try {
    const p = token.split('.')[1];
    return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

async function refreshSession() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new Error('Oturum süresi doldu; yeniden giriş yapın.');
  }
  const url = `${getApiBase()}/auth/refresh`;
  const res = await fetchWithNetworkHint(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (!res.ok) {
    setToken(null);
    const err = new Error(
      Array.isArray(body?.message)
        ? body.message.join(', ')
        : body?.message ?? res.statusText,
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }
  setToken(body.accessToken, body.refreshToken);
}

export async function api(path, opts = {}, isRetry = false) {
  const url = `${getApiBase()}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetchWithNetworkHint(url, { ...opts, headers });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }

  if (res.status === 401 && !isRetry && getRefreshToken()) {
    const isAuthPath =
      path.startsWith('/auth/otp/') ||
      path === '/auth/owner/login' ||
      path === '/auth/refresh';
    if (!isAuthPath) {
      try {
        if (!refreshPromise) {
          refreshPromise = refreshSession().finally(() => {
            refreshPromise = null;
          });
        }
        await refreshPromise;
        return api(path, opts, true);
      } catch {
        /* fall through to error handling below */
      }
    }
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
