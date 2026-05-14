const TOKEN_KEY = 'daino_authority_token';
const REFRESH_KEY = 'daino_authority_refresh';

let refreshPromise = null;

export function getApiBase() {
  const raw = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';
  return raw.replace(/\/$/, '');
}

/** Native WS for staff order list push (`/ws/orders?token=…`). */
export function getOrdersWsUrl() {
  const explicit = import.meta.env.VITE_ORDERS_WS_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const base = getApiBase();
  try {
    const httpUrl = new URL(
      /^https?:\/\//i.test(base) ? base : `http://${base}`,
    );
    const wsProto = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${httpUrl.host}/ws/orders`;
  } catch {
    return 'ws://localhost:3000/ws/orders';
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
    throw new Error('Session expired; please sign in again.');
  }
  const url = `${getApiBase()}/auth/refresh`;
  const res = await fetch(url, {
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

/**
 * @param {File} file
 * @param {boolean} [isRetry]
 * @returns {Promise<{ url: string, publicId?: string }>}
 */
export async function uploadAdminImage(file, isRetry = false) {
  const url = `${getApiBase()}/admin/uploads/image`;
  const fd = new FormData();
  fd.append('file', file);
  /** @type {Record<string, string>} */
  const headers = {};
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(url, { method: 'POST', headers, body: fd });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }

  if (res.status === 401 && !isRetry && getRefreshToken()) {
    try {
      if (!refreshPromise) {
        refreshPromise = refreshSession().finally(() => {
          refreshPromise = null;
        });
      }
      await refreshPromise;
      return uploadAdminImage(file, true);
    } catch {
      /* fall through */
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

export async function api(path, opts = {}, isRetry = false) {
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
        /* fall through */
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
