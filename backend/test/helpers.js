import http from 'node:http';
import { createContext } from '../src/context.js';
import { createApp } from '../src/app.js';

/** Boots the real app on an ephemeral port. Replay is manual (tick 0) so tests control it. */
export async function startServer(extraEnv = {}) {
  const ctx = await createContext({
    LOG_LEVEL: 'silent',
    REPLAY_TICK_MS: '0',
    REPLAY_AUTOSTART: 'false',
    WS_HEARTBEAT_MS: '200',
    ...extraEnv,
  });
  const app = createApp(ctx);
  const server = http.createServer(app);
  ctx.hub.attach(server);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = () =>
    new Promise((r) => {
      ctx.hub.close();
      server.close(r);
    });
  const api = async (method, path, { token, body } = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const login = async (role) =>
    (await api('POST', '/auth/login', { body: { email: `${role}@pureinsights.demo`, password: 'Passw0rd!' } })).body.token;
  return { ctx, app, base, api, login, stop, port: server.address().port };
}
