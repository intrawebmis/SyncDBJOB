import express from 'express';
import path from 'node:path';
import { env } from './config/env';
import { createApiRouter } from './web/routes';
import { getAuthService } from './auth/service';
import { requireAuthPage, attachAuth } from './auth/middleware';
import { logger } from './utils/logger';

export function createApp(): express.Express {
  const app = express();

  // ถ้าวางหลัง nginx/reverse proxy ให้เชื่อ X-Forwarded-* (ใช้หา IP จริง + Secure cookie)
  if (env.APP_TRUST_PROXY) app.set('trust proxy', 1);

  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true }));

  const auth = getAuthService();

  // อ่าน session จาก cookie แล้วแนบข้อมูลผู้ใช้ไว้ใน request (ทั้ง API และหน้าเว็บ)
  app.use(attachAuth(auth));

  app.use('/api', createApiRouter());

  const publicDir = path.resolve(process.cwd(), 'public');

  // หน้าเข้าสู่ระบบ + ไฟล์ประกอบของหน้าเข้าสู่ระบบ — เข้าถึงได้โดยไม่ต้องล็อกอิน
  app.get(['/login', '/login.html'], (_req, res) => {
    res.sendFile(path.join(publicDir, 'login.html'));
  });
  app.get('/login.css', (_req, res) => {
    res.sendFile(path.join(publicDir, 'login.css'));
  });
  app.get('/login.js', (_req, res) => {
    res.sendFile(path.join(publicDir, 'login.js'));
  });

  // หน้าเว็บที่เหลือทั้งหมด — ต้องล็อกอินก่อน (ไม่ล็อกอินจะถูกส่งไปหน้า /login)
  app.use(requireAuthPage(auth));
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
      const auth = getAuthService();
      logger.info(`Web UI พร้อมใช้งาน → http://${host}:${port}`);
      logger.info(
        auth.enabled
          ? `ระบบล็อกอิน: เปิดใช้งาน (ตารางผู้ใช้ "${env.AUTH_USERS_TABLE}")`
          : 'ระบบล็อกอิน: ปิดใช้งาน (APP_AUTH_ENABLED=false) — ไม่ควรเปิดสู่อินเทอร์เน็ต',
      );
      resolve();
    });
    server.on('error', (err) => {
      logger.error(`เปิดพอร์ต ${port} ไม่สำเร็จ: ${err.message}`);
      process.exit(1);
    });
  });
}
