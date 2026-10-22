import express from 'express';
import path from 'node:path';
import { env } from './config/env';
import { createApiRouter } from './web/routes';
import { logger } from './utils/logger';

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api', createApiRouter());

  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error(`[web] ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  });

  return app;
}

export async function startServer(port: number = env.APP_PORT, host: string = env.APP_HOST): Promise<void> {
  const app = createApp();
  await new Promise<void>((resolve) => {
    const server = app.listen(port, host, () => {
      logger.info(`Web UI พร้อมใช้งาน → http://${host}:${port}`);
      resolve();
    });
    server.on('error', (err) => {
      logger.error(`เปิดพอร์ต ${port} ไม่สำเร็จ: ${err.message}`);
      process.exit(1);
    });
  });
}
