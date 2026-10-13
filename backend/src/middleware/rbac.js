import jwt from 'jsonwebtoken';
import { forbidden, unauthorized } from '../utils/errors.js';

export const ROLES = ['admin', 'analyst', 'viewer'];

/** Permission matrix: permission -> roles allowed. Mirrored in docs/API_SPEC.md and the UI route guards. */
export const PERMISSIONS = {
  'dashboard:read': ['admin', 'analyst', 'viewer'],
  'alerts:read': ['admin', 'analyst', 'viewer'],
  'alerts:ack': ['admin', 'analyst'],
  'alerts:inject': ['admin'],
  'costs:read': ['admin', 'analyst'],
  'dq:read': ['admin', 'analyst'],
  'orphans:assign': ['admin'],
  'users:manage': ['admin'],
  'replay:control': ['admin'],
  'audit:read': ['admin'],
};

export const can = (role, permission) => (PERMISSIONS[permission] ?? []).includes(role);

export function verifyToken(token, secret) {
  try {
    return jwt.verify(token, secret);
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

export function authenticate(secret) {
  return (req, _res, next) => {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) return next(unauthorized());
    try {
      const claims = verifyToken(header.slice(7), secret);
      req.user = { id: claims.sub, email: claims.email, role: claims.role };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export const authorize = (permission) => (req, _res, next) =>
  can(req.user?.role, permission) ? next() : next(forbidden(`Requires permission ${permission}`));
