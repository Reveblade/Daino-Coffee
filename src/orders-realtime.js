import { getOrdersWsUrl, getToken } from './api.js';

const MAX_BACKOFF_MS = 30_000;

/** @type {WebSocket | null} */
let ws = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let reconnectTimer = null;
let attempt = 0;
let userDisconnect = false;

/**
 * @param {object} handlers
 * @param {() => void} handlers.onOrdersPush
 * @param {(open: boolean) => void} [handlers.onConnectionChange]
 * @returns {() => void}
 */
export function connectOrdersStaffRealtime(handlers) {
  userDisconnect = false;

  const scheduleReconnect = () => {
    if (userDisconnect || reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const tok = getToken();
    if (!tok) {
      handlers.onConnectionChange?.(false);
      return;
    }
    try {
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
      const base = getOrdersWsUrl();
      const url = `${base}?token=${encodeURIComponent(tok)}`;
      ws = new WebSocket(url);
    } catch {
      handlers.onConnectionChange?.(false);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      attempt = 0;
      handlers.onConnectionChange?.(true);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg?.type === 'orders') handlers.onOrdersPush();
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      ws = null;
      handlers.onConnectionChange?.(false);
      if (!userDisconnect) scheduleReconnect();
    };

    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  };

  connect();

  return () => {
    userDisconnect = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    attempt = 0;
    handlers.onConnectionChange?.(false);
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  };
}
