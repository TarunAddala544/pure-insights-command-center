import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { buildControllers } from '../controllers/index.js';

const alertQuery = z.object({
  severity: z.enum(['WARN', 'HIGH', 'CRIT']).optional(),
  status: z.enum(['open', 'acknowledged', 'resolved']).optional(),
  rule: z.enum(['LATENCY_GT_15S', 'REFRESH_FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const priceQuery = z.object({ price: z.coerce.number().positive().max(1000).optional() });
const emailField = z.string().email().max(254);

/**
 * Single source of truth for REST endpoints. [method, path, permission|null|'public', handler key, schemas].
 * docs/openapi.yaml is checked against this table by test/spec.test.js.
 */
export const buildRouteTable = (c) => [
  ['post', '/auth/login', 'public', c.login, { body: z.object({ email: emailField, password: z.string().min(1).max(200) }) }],
  ['get', '/health', 'public', c.health],
  ['get', '/auth/me', null, c.me],
  ['get', '/overview', 'dashboard:read', c.overview],
  ['get', '/reports', 'dashboard:read', c.reports],
  ['get', '/reports/:id', 'dashboard:read', c.reportDetail, { params: z.object({ id: z.string().regex(/^RPT_\d+$/) }) }],
  ['get', '/orphans', 'dashboard:read', c.orphans],
  [
    'post',
    '/orphans/:reportId/assign',
    'orphans:assign',
    c.assignOwner,
    { params: z.object({ reportId: z.string().regex(/^RPT_\d+$/) }), body: z.object({ ownerEmail: emailField }) },
  ],
  ['get', '/usage', 'dashboard:read', c.usage],
  ['get', '/costs', 'costs:read', c.costs, { query: priceQuery }],
  ['get', '/costs/summary', 'costs:read', c.costSummary, { query: priceQuery }],
  ['get', '/data-quality', 'dq:read', c.dataQuality],
  ['get', '/quarantine', 'dq:read', c.quarantine],
  ['get', '/alerts', 'alerts:read', c.alerts, { query: alertQuery }],
  [
    'post',
    '/alerts/inject',
    'alerts:inject',
    c.injectAlert,
    {
      body: z
        .object({
          reportId: z.string().regex(/^RPT_\d+$/),
          latencySec: z.number().min(0).max(3600).optional(),
          refreshStatus: z.enum(['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN']).optional(),
        })
        .refine((b) => b.latencySec !== undefined || b.refreshStatus !== undefined, 'latencySec or refreshStatus is required'),
    },
  ],
  ['post', '/alerts/:id/ack', 'alerts:ack', c.ackAlert, { params: z.object({ id: z.string() }) }],
  ['post', '/alerts/:id/resolve', 'alerts:ack', c.resolveAlert, { params: z.object({ id: z.string() }) }],
  ['get', '/telemetry', 'dashboard:read', c.telemetry],
  ['get', '/replay', 'dashboard:read', c.replayStatus],
  ['post', '/replay/start', 'replay:control', c.replayAction('start')],
  ['post', '/replay/pause', 'replay:control', c.replayAction('pause')],
  ['post', '/replay/reset', 'replay:control', c.replayAction('reset')],
  ['get', '/users', 'users:manage', c.users],
  [
    'patch',
    '/users/:id',
    'users:manage',
    c.updateUser,
    {
      params: z.object({ id: z.string() }),
      body: z
        .object({ role: z.enum(['admin', 'analyst', 'viewer']).optional(), active: z.boolean().optional() })
        .refine((b) => Object.keys(b).length > 0, 'role or active is required'),
    },
  ],
  ['get', '/audit', 'audit:read', c.audit],
];

export function buildRouter(ctx) {
  const router = Router();
  const table = buildRouteTable(buildControllers(ctx));
  for (const [method, path, permission, handler, schemas = {}] of table) {
    const chain = [];
    if (permission !== 'public') chain.push(authenticate(ctx.cfg.jwtSecret));
    if (permission && permission !== 'public') chain.push(authorize(permission));
    if (Object.keys(schemas).length) chain.push(validate(schemas));
    router[method](path, ...chain, handler);
  }
  return { router, table };
}
