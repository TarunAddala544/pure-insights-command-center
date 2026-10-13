import { WebSocketServer } from 'ws';
import { URL } from 'node:url';
import { verifyToken, can } from '../middleware/rbac.js';
import { severityRank } from '../domain/alerts.js';

/** Channel -> permission needed to receive it. Role-aware fan-out. */
const CHANNEL_PERMISSION = { alerts: 'alerts:read', ops: 'costs:read', admin: 'audit:read' };
export const CLOSE = { UNAUTHORIZED: 4401, HEARTBEAT: 4408 };

/** JWT-authenticated WebSocket hub with heartbeat, per-client alert filters and role-aware channels. */
export class Hub {
  constructor({ jwtSecret, heartbeatMs, logger, onAckRequest }) {
    this.secret = jwtSecret;
    this.heartbeatMs = heartbeatMs;
    this.logger = logger;
    this.onAckRequest = onAckRequest;
    this.clients = new Set();
    this.seq = 0;
    this.wss = new WebSocketServer({ noServer: true });
  }

  attach(httpServer) {
    httpServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/ws') return socket.destroy();
      try {
        const claims = verifyToken(this.#tokenFrom(req, url), this.secret);
        return this.wss.handleUpgrade(req, socket, head, (ws) => this.#onConnect(ws, claims));
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return socket.destroy();
      }
    });
    this.timer = setInterval(() => this.#heartbeat(), this.heartbeatMs);
    this.timer.unref();
  }

  #tokenFrom(req, url) {
    const proto = req.headers['sec-websocket-protocol'];
    if (proto?.startsWith('bearer.')) return proto.slice(7);
    return url.searchParams.get('token') ?? '';
  }

  #onConnect(ws, claims) {
    const client = {
      ws,
      user: { id: claims.sub, email: claims.email, role: claims.role },
      filter: { minSeverity: 'WARN', rules: null },
      alive: true,
    };
    this.clients.add(client);
    ws.on('pong', () => {
      client.alive = true;
    });
    ws.on('message', (raw) => this.#onMessage(client, raw));
    ws.on('close', () => this.clients.delete(client));
    ws.on('error', (err) => this.logger.warn('ws error', { error: err.message }));
    this.#send(client, 'hello', { user: client.user, heartbeatMs: this.heartbeatMs, channels: this.#channelsFor(client.user.role) });
  }

  #channelsFor(role) {
    return Object.entries(CHANNEL_PERMISSION)
      .filter(([, p]) => can(role, p))
      .map(([c]) => c);
  }

  async #onMessage(client, raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return this.#error(client, 'BAD_MESSAGE', 'Message must be JSON');
    }
    if (msg.type === 'ping') return this.#send(client, 'pong', {});
    if (msg.type === 'subscribe') {
      client.filter = { minSeverity: msg.data?.minSeverity ?? 'WARN', rules: msg.data?.rules ?? null };
      return this.#send(client, 'subscribed', client.filter);
    }
    if (msg.type === 'ack') {
      if (!can(client.user.role, 'alerts:ack')) return this.#error(client, 'FORBIDDEN', 'Role cannot acknowledge alerts');
      const result = await this.onAckRequest(msg.data?.alertId, client.user);
      return result ? undefined : this.#error(client, 'NOT_FOUND', 'Unknown alert id');
    }
    return this.#error(client, 'BAD_MESSAGE', `Unknown message type ${msg.type}`);
  }

  #send(client, type, data) {
    if (client.ws.readyState !== 1) return;
    client.ws.send(JSON.stringify({ type, seq: ++this.seq, ts: new Date().toISOString(), data }));
  }

  #error(client, code, message) {
    this.#send(client, 'error', { code, message });
  }

  /** Sends to every client whose role may read the channel (and whose alert filter matches). */
  broadcast(type, data, channel = 'alerts') {
    for (const client of this.clients) {
      if (!can(client.user.role, CHANNEL_PERMISSION[channel])) continue;
      if (type === 'alert' && !this.#matches(client.filter, data)) continue;
      this.#send(client, type, data);
    }
  }

  #matches(filter, alert) {
    if (severityRank(alert.severity) < severityRank(filter.minSeverity)) return false;
    return !filter.rules || filter.rules.includes(alert.rule);
  }

  #heartbeat() {
    for (const client of this.clients) {
      if (!client.alive) {
        client.ws.close(CLOSE.HEARTBEAT, 'heartbeat timeout');
        this.clients.delete(client);
        continue;
      }
      client.alive = false;
      client.ws.ping();
      this.#send(client, 'heartbeat', { connections: this.clients.size });
    }
  }

  get size() {
    return this.clients.size;
  }

  close() {
    clearInterval(this.timer);
    for (const c of this.clients) c.ws.terminate();
    this.wss.close();
  }
}
