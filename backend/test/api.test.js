import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { PERMISSIONS } from '../src/middleware/rbac.js';

let s;
const tokens = {};
before(async () => {
  s = await startServer();
  for (const role of ['admin', 'analyst', 'viewer']) tokens[role] = await s.login(role);
});
after(() => s.stop());

test('login: wrong password -> 401 with error envelope', async () => {
  const r = await s.api('POST', '/auth/login', { body: { email: 'admin@pureinsights.demo', password: 'nope' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'UNAUTHORIZED');
  assert.ok(r.body.error.requestId);
});

test('login: invalid body -> 400 with details', async () => {
  const r = await s.api('POST', '/auth/login', { body: { email: 'not-an-email' } });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.details.length >= 1);
});

test('protected endpoint without token -> 401', async () => {
  assert.equal((await s.api('GET', '/overview')).status, 401);
});

// Role x endpoint matrix: [method, path, permission, body]
const MATRIX = [
  ['GET', '/overview', 'dashboard:read'],
  ['GET', '/costs/summary', 'costs:read'],
  ['GET', '/costs', 'costs:read'],
  ['GET', '/data-quality', 'dq:read'],
  ['GET', '/quarantine', 'dq:read'],
  ['GET', '/alerts', 'alerts:read'],
  ['GET', '/users', 'users:manage'],
  ['GET', '/audit', 'audit:read'],
  ['POST', '/replay/pause', 'replay:control'],
  ['POST', '/alerts/inject', 'alerts:inject', { reportId: 'RPT_200', latencySec: 20 }],
  ['POST', '/alerts/ALT-NOPE/ack', 'alerts:ack'],
  ['POST', '/orphans/RPT_200/assign', 'orphans:assign', { ownerEmail: 'x@company.com' }],
];

for (const [method, path, permission, body] of MATRIX) {
  test(`RBAC ${method} ${path}: roles without ${permission} get 403, allowed roles do not`, async () => {
    for (const role of ['admin', 'analyst', 'viewer']) {
      const r = await s.api(method, path, { token: tokens[role], body });
      if (PERMISSIONS[permission].includes(role)) assert.notEqual(r.status, 403, `${role} should be allowed`);
      else assert.equal(r.status, 403, `${role} should be forbidden`);
    }
  });
}

test('replay + orphan assignment + ack flow', async () => {
  await s.ctx.replay.step();
  const list = await s.api('GET', '/alerts?limit=1', { token: tokens.viewer });
  assert.equal(list.status, 200);
  const id = list.body.items[0].id;
  assert.equal((await s.api('POST', `/alerts/${id}/ack`, { token: tokens.viewer })).status, 403);
  const ack = await s.api('POST', `/alerts/${id}/ack`, { token: tokens.analyst });
  assert.equal(ack.body.status, 'acknowledged');

  const before = (await s.api('GET', '/orphans', { token: tokens.viewer })).body.orphanedNow;
  const target = before[0].report_id;
  const assign = await s.api('POST', `/orphans/${target}/assign`, { token: tokens.admin, body: { ownerEmail: 'New.Owner@company.com' } });
  assert.equal(assign.status, 201);
  const after = (await s.api('GET', '/orphans', { token: tokens.viewer })).body.orphanedNow;
  assert.equal(after.length, before.length - 1);
  assert.equal((await s.api('POST', `/orphans/${target}/assign`, { token: tokens.admin, body: { ownerEmail: 'a@b.co' } })).status, 409);
});

test('cost endpoints: price parameter rescales cost and keeps unit cost safe', async () => {
  const base = (await s.api('GET', '/costs/summary', { token: tokens.analyst })).body;
  const doubled = (await s.api('GET', '/costs/summary?price=6', { token: tokens.analyst })).body;
  assert.ok(Math.abs(doubled.fleet.unitCostPerViewUsd / base.fleet.unitCostPerViewUsd - 2) < 1e-3);
  assert.ok(base.reconciliation.every((c) => c.passed));
  assert.equal((await s.api('GET', '/costs?price=-1', { token: tokens.analyst })).status, 400);
});

test('data quality endpoint reports all four defects', async () => {
  const dq = (await s.api('GET', '/data-quality', { token: tokens.analyst })).body;
  assert.deepEqual(
    dq.defects.map((d) => d.code),
    ['ORPHANED_REPORTS', 'NEGATIVE_CREDITS', 'LATENCY_SPIKES', 'USERS_VS_AWS'],
  );
  assert.equal(dq.defects[1].affectedRows, 24);
});

test('unknown route -> 404 envelope', async () => {
  const r = await s.api('GET', '/nope', { token: tokens.admin });
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'NOT_FOUND');
});
