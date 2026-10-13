import http from 'node:http';
import { createContext } from './context.js';
import { createApp } from './app.js';

const ctx = await createContext();
const app = createApp(ctx);
const server = http.createServer(app);
ctx.hub.attach(server);
server.listen(ctx.cfg.port, () => {
  ctx.logger.info('server listening', { port: ctx.cfg.port, ws: '/ws', simulatedSnowflake: true });
  if (ctx.cfg.replay.autostart) ctx.replay.start();
});

const shutdown = () => {
  ctx.replay.pause();
  ctx.hub.close();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
