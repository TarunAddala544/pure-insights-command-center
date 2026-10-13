import { useEffect, useRef, useState } from 'react';
import { tokenStore } from '../api.js';

const MAX_BACKOFF_MS = 15_000;

/**
 * WebSocket client with JWT handshake, auto-reconnect (exponential backoff + jitter) and a status flag.
 * onMessage receives every parsed envelope. onReconnect fires after a re-established connection.
 */
export function useAlertSocket({ enabled, onMessage, onReconnect }) {
  const [status, setStatus] = useState('connecting');
  const handlers = useRef({ onMessage, onReconnect });
  handlers.current = { onMessage, onReconnect };

  useEffect(() => {
    if (!enabled) return undefined;
    let ws;
    let attempt = 0;
    let timer;
    let closedByUs = false;
    let hasConnectedBefore = false;

    const connect = () => {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${scheme}://${window.location.host}/ws?token=${encodeURIComponent(tokenStore.get() ?? '')}`);
      ws.onopen = () => {
        attempt = 0;
        setStatus('open');
        if (hasConnectedBefore) handlers.current.onReconnect?.();
        hasConnectedBefore = true;
      };
      ws.onmessage = (e) => {
        try {
          handlers.current.onMessage(JSON.parse(e.data));
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (closedByUs) return;
        setStatus('reconnecting');
        const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS) * (0.75 + Math.random() * 0.5);
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      closedByUs = true;
      clearTimeout(timer);
      ws?.close();
      setStatus('closed');
    };
  }, [enabled]);

  return status;
}
