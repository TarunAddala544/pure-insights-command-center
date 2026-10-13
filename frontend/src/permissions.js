/** Mirrors backend/src/middleware/rbac.js PERMISSIONS (UI hint only: the server is the authority). */
export const PERMISSIONS = {
  'dashboard:read': ['admin', 'analyst', 'viewer'],
  'alerts:read': ['admin', 'analyst', 'viewer'],
  'alerts:ack': ['admin', 'analyst'],
  'costs:read': ['admin', 'analyst'],
  'dq:read': ['admin', 'analyst'],
  'orphans:assign': ['admin'],
  'alerts:inject': ['admin'],
  'replay:control': ['admin'],
  'users:manage': ['admin'],
  'audit:read': ['admin'],
};
export const can = (role, permission) => (PERMISSIONS[permission] ?? []).includes(role);
