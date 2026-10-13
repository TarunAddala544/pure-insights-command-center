import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer } from './helpers.js';

let s;
before(async () => {
  s = await startServer();
});
after(() => s.stop());

const connect = (token) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=${token}`);
    const inbox = [];
    ws.on('message', (m) => inbox.push(JSON.parse(m.toString())));
    ws.on('open', () => resolve({ ws, inbox }));
    ws.on('error', reject);
  });
const waitFor = async (inbox, pred, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = inbox.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out waiting for message');
};

test('WS rejects unauthenticated and invalid-token clients', async () => {
  for (const url of [`ws://127.0.0.1:${s.port}/ws`, `ws://127.0.0.1:${s.port}/ws?token=garbage`]) {
    await new Promise((resolve) => {
      const ws = new WebSocket(url);
      ws.on('unexpected-response', (_req, res) => {
        assert.equal(res.statusCode, 401);
        resolve();
      });
      ws.on('open', () => assert.fail('must not open'));
      ws.on('error', () => resolve());
    });
  }
});

test('E2E: >15 s latency and a refresh failure alerts arrive within 1 s', async () => {
  const admin = await connect(await s.login('admin'));
  await waitFor(admin.inbox, (m) => m.type === 'hello');
  const started = Date.now();
  const res = await s.api('POST', '/alerts/inject', { token: await s.login('admin'), body: { reportId: 'RPT_210', latencySec: 16.5 } });
  assert.equal(res.status, 201);
  await s.api('POST', '/alerts/inject', { token: await s.login('admin'), body: { reportId: 'RPT_211', refreshStatus: 'FAILED' } });
  const latency = await waitFor(
    admin.inbox,
    (m) => m.type === 'alert' && m.data.rule === 'LATENCY_GT_15S' && m.data.reportId === 'RPT_210',
    1000,
  );
  const refresh = await waitFor(
    admin.inbox,
    (m) => m.type === 'alert' && m.data.rule === 'REFRESH_FAILED' && m.data.reportId === 'RPT_211',
    1000,
  );
  assert.ok(Date.now() - started < 1000);
  assert.equal(latency.data.severity, 'WARN');
  assert.equal(refresh.data.value, 'FAILED');
  admin.ws.close();
});

test('E2E: replay stream delivers alerts, no duplicates by seq, in order', async () => {
  const analyst = await connect(await s.login('analyst'));
  await s.ctx.replay.reset();
  await s.ctx.replay.step();
  await waitFor(analyst.inbox, (m) => m.type === 'replay_status');
  const alerts = analyst.inbox.filter((m) => m.type === 'alert' && m.data.source === 'replay');
  assert.ok(alerts.length > 0);
  const seqs = analyst.inbox.map((m) => m.seq);
  assert.deepEqual(
    seqs,
    [...seqs].sort((a, b) => a - b),
  );
  assert.equal(new Set(seqs).size, seqs.length);
  analyst.ws.close();
});

test('role-aware channels: viewer gets alerts but not ops telemetry', async () => {
  const viewer = await connect(await s.login('viewer'));
  const hello = await waitFor(viewer.inbox, (m) => m.type === 'hello');
  assert.deepEqual(hello.data.channels, ['alerts']);
  await s.ctx.replay.step();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(
    viewer.inbox.some((m) => m.type === 'replay_status'),
    false,
  );
  assert.ok(viewer.inbox.some((m) => m.type === 'alert'));
  viewer.ws.close();
});

test('subscribe filter limits severity; viewer cannot ack over WS', async () => {
  const viewer = await connect(await s.login('viewer'));
  await waitFor(viewer.inbox, (m) => m.type === 'hello');
  viewer.ws.send(JSON.stringify({ type: 'subscribe', data: { minSeverity: 'CRIT' } }));
  await waitFor(viewer.inbox, (m) => m.type === 'subscribed');
  viewer.inbox.length = 0;
  await s.ctx.replay.step();
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(viewer.inbox.filter((m) => m.type === 'alert').every((m) => m.data.severity === 'CRIT'));
  viewer.ws.send(JSON.stringify({ type: 'ack', data: { alertId: 'ALT-1' } }));
  const err = await waitFor(viewer.inbox, (m) => m.type === 'error');
  assert.equal(err.data.code, 'FORBIDDEN');
  viewer.ws.send('not json');
  await waitFor(viewer.inbox, (m) => m.type === 'error' && m.data.code === 'BAD_MESSAGE');
  viewer.ws.close();
});

test('heartbeat messages are delivered', async () => {
  const c = await connect(await s.login('admin'));
  await waitFor(c.inbox, (m) => m.type === 'heartbeat', 1500);
  c.ws.close();
});
