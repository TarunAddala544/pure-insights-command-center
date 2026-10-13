import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'yaml';
import { startServer } from './helpers.js';
import { PERMISSIONS } from '../src/middleware/rbac.js';
import { loadConfig } from '../src/config/index.js';

const root = loadConfig().root;

test('openapi.yaml lists exactly the implemented REST routes and permissions', async () => {
  const s = await startServer();
  try {
    const spec = parse(fs.readFileSync(`${root}/docs/openapi.yaml`, 'utf8'));
    const documented = new Map();
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops))
        documented.set(`${method.toUpperCase()} ${path.replace(/{(\w+)}/g, ':$1')}`, op['x-permission']);
    }
    const implemented = new Map(s.app.routeTable.map(([m, p, perm]) => [`${m.toUpperCase()} ${p}`, perm ?? 'authenticated']));
    assert.deepEqual([...documented.keys()].sort(), [...implemented.keys()].sort());
    for (const [key, perm] of implemented) assert.equal(documented.get(key), perm, key);
  } finally {
    await s.stop();
  }
});

test('API_SPEC.md documents every route and every permission in the matrix', () => {
  const md = fs.readFileSync(`${root}/docs/API_SPEC.md`, 'utf8');
  const spec = parse(fs.readFileSync(`${root}/docs/openapi.yaml`, 'utf8'));
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const method of Object.keys(ops))
      assert.ok(md.includes(`${method.toUpperCase()} /api${path}`), `${method} ${path} missing from API_SPEC.md`);
  }
  for (const permission of Object.keys(PERMISSIONS)) assert.ok(md.includes(permission), `${permission} missing from API_SPEC.md`);
});

test('API_SPEC.md documents every WebSocket message type implemented', () => {
  const md = fs.readFileSync(`${root}/docs/API_SPEC.md`, 'utf8');
  for (const type of [
    'hello',
    'alert',
    'incident_update',
    'telemetry',
    'replay_status',
    'heartbeat',
    'subscribe',
    'subscribed',
    'ack',
    'ping',
    'pong',
    'error',
  ]) {
    assert.ok(md.includes(`\`${type}\``), `ws type ${type} missing`);
  }
});
