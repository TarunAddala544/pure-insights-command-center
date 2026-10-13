import React, { createContext, useCallback, useContext, useState } from 'react';
import { useAlertSocket } from './hooks/useAlertSocket.js';
import { useAuth } from './auth.jsx';

const AlertsContext = createContext(null);
export const useLiveAlerts = () => useContext(AlertsContext);
const FEED_LIMIT = 300;

/** App-level live state: feed of every firing, toasts for toast-flagged alerts, replay status, socket status. */
export function AlertsProvider({ children }) {
  const { user } = useAuth();
  const [feed, setFeed] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [replay, setReplay] = useState(null);
  const [reconnects, setReconnects] = useState(0);

  const pushToast = useCallback((alert) => {
    const id = `${alert.dedupeKey}-${alert.sweep}-${Date.now()}`;
    setToasts((t) => [...t.slice(-3), { id, alert }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const onMessage = useCallback(
    (msg) => {
      if (msg.type === 'alert') {
        setFeed((f) => [{ ...msg.data, receivedAt: msg.ts }, ...f].slice(0, FEED_LIMIT));
        if (msg.data.toast) pushToast(msg.data);
      } else if (msg.type === 'replay_status') setReplay(msg.data);
    },
    [pushToast],
  );

  const status = useAlertSocket({ enabled: Boolean(user), onMessage, onReconnect: () => setReconnects((n) => n + 1) });
  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id));
  const clearFeed = () => setFeed([]);

  return (
    <AlertsContext.Provider value={{ feed, toasts, status, replay, reconnects, dismiss, clearFeed }}>{children}</AlertsContext.Provider>
  );
}
