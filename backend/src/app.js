import crypto from 'node:crypto';
import express from 'express';
import { buildRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp(ctx) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    res.setHeader('Access-Control-Allow-Origin', ctx.cfg.corsOrigin ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    const started = Date.now();
    res.on('finish', () =>
      ctx.logger.info('request', { id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started }),
    );
    return next();
  });
  const { router, table } = buildRouter(ctx);
  app.use('/api', router);
  app.use(notFoundHandler);
  app.use(errorHandler(ctx.logger));
  app.routeTable = table;
  return app;
}
