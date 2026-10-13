import { HttpError } from '../utils/errors.js';

/** Consistent error envelope: { error: { code, message, details?, requestId } }. */
export const notFoundHandler = (req, _res, next) => next(new HttpError(404, 'NOT_FOUND', `No route ${req.method} ${req.path}`));

export const errorHandler = (logger) => (err, req, res, _next) => {
  const known = err instanceof HttpError;
  const status = known ? err.status : err.type === 'entity.parse.failed' ? 400 : 500;
  if (status >= 500) logger.error('unhandled error', { requestId: req.id, error: err.message });
  res.status(status).json({
    error: {
      code: known ? err.code : status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
      message: status >= 500 ? 'Internal server error' : err.message,
      ...(known && err.details ? { details: err.details } : {}),
      requestId: req.id,
    },
  });
};
