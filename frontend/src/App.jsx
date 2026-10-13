import React, { useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';
import { AlertsProvider, useLiveAlerts } from './alerts.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Orphans from './pages/Orphans.jsx';
import Alerts from './pages/Alerts.jsx';
import Costs from './pages/Costs.jsx';
import DataQuality from './pages/DataQuality.jsx';
import Admin from './pages/Admin.jsx';
import { Badge, severityTone } from './components/ui.jsx';

/** Route table with the permission each page needs: the guard hides nav links and blocks direct hash access. */
const ROUTES = [
  { path: 'health', label: 'System health', permission: 'dashboard:read', Page: Overview },
  { path: 'orphans', label: 'Orphaned reports', permission: 'dashboard:read', Page: Orphans },
  { path: 'alerts', label: 'Live alerts', permission: 'alerts:read', Page: Alerts },
  { path: 'costs', label: 'Cost attribution', permission: 'costs:read', Page: Costs },
  { path: 'quality', label: 'Data quality', permission: 'dq:read', Page: DataQuality },
  { path: 'admin', label: 'Admin', permission: 'users:manage', Page: Admin },
];

const currentPath = () => window.location.hash.replace('#/', '') || 'health';

function Toasts() {
  const { toasts, dismiss } = useLiveAlerts();
  return (
    <div className="toasts" aria-live="assertive">
      {toasts.map(({ id, alert }) => (
        <div key={id} className={`toast ${severityTone(alert.severity)}`} role="alert">
          <strong>{alert.rule === 'REFRESH_FAILED' ? 'Refresh failed' : `Latency ${alert.value}s`}</strong> · {alert.reportId} ·{' '}
          <Badge tone={severityTone(alert.severity)}>{alert.severity}</Badge>
          <button aria-label="Dismiss" onClick={() => dismiss(id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function Shell() {
  const { user, logout, can } = useAuth();
  const live = useLiveAlerts();
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const onHash = () => setPath(currentPath());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const allowed = ROUTES.filter((r) => can(r.permission));
  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  return (
    <>
      <header>
        <strong>Pure Insights Command Center</strong>
        <nav aria-label="Main">
          {allowed.map((r) => (
            <a key={r.path} href={`#/${r.path}`} aria-current={r.path === route.path ? 'page' : undefined}>
              {r.label}
            </a>
          ))}
        </nav>
        <span className="who">
          <Badge tone={live.status === 'open' ? 'ok' : 'crit'}>{live.status === 'open' ? '● live' : `● ${live.status}`}</Badge> {user.email}{' '}
          ({user.role})<button onClick={logout}>Log out</button>
        </span>
      </header>
      <main>
        {can(route.permission) ? (
          <route.Page />
        ) : (
          <p className="error" role="alert">
            403 — your role ({user.role}) cannot open this page.
          </p>
        )}
      </main>
      <Toasts />
    </>
  );
}

export default function App() {
  const { user, booting } = useAuth();
  if (booting)
    return (
      <p className="muted" role="status">
        Loading…
      </p>
    );
  if (!user) return <Login />;
  return (
    <AlertsProvider>
      <Shell />
    </AlertsProvider>
  );
}
