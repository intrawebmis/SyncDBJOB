import express from 'express';
import path from 'node:path';
import { env } from './config/env';
import { createApiRouter } from './web/routes';
import { getAuthService } from './auth/service';
import { attachAuth, requireAuthPage } from './auth/middleware';
import { logger } from './utils/logger';

/**
 * ฐานพาธที่แอปถูก mount ไว้
 * - ว่าง        → อยู่ที่ root เช่น https://example.com/
 * - '/SyncJOB'  → อยู่ใต้โฟลเดอร์ย่อย เช่น https://example.com/SyncJOB/
 */
export function basePath(): string {
  const raw = String(env.APP_BASE_PATH || '').trim();
  if (!raw || raw === '/') return '';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, '');
}

/**
 * ส่งไฟล์ HTML ให้เบราว์เซอร์
 *
 * หน้าเว็บใช้ URL แบบ relative ทั้งหมด (styles.css, app.js, api/...)
 * จึงไม่ต้องแก้ไฟล์ตอนรัน — ใช้ได้ทั้งติดตั้งที่ root และใต้ subfolder
 * และใช้ได้แม้โฮสติ้งจะเสิร์ฟไฟล์ HTML เองแทน Node
 */
function sendHtml(res: express.Response, file: string): void {
  res.sendFile(file, (err?: Error) => {
    if (err) {
      logger.error(`[web] อ่านไฟล์ ${file} ไม่สำเร็จ`, err.message);
      if (!res.headersSent) res.status(500).send('ไม่พบไฟล์หน้าเว็บ');
    }
  });
}

export function createApp(): express.Express {
  const app = express();
  const base = basePath();

  // ถ้าวางหลัง nginx/reverse proxy ให้เชื่อ X-Forwarded-* (ใช้หา IP จริง + Secure cookie)
  if (env.APP_TRUST_PROXY) app.set('trust proxy', 1);

  // ===== สร้าง sub-app สำหรับทุก route (รองรับการติดตั้งใต้ subfolder) =====
  const root = express();
  const publicDir = path.resolve(process.cwd(), 'public');
  const auth = getAuthService();

  root.use(express.json({ limit: '20mb' }));
  root.use(express.urlencoded({ extended: true }));

  // อ่าน session จาก cookie แล้วแนบข้อมูลผู้ใช้ไว้ใน request (ทั้ง API และหน้าเว็บ)
  root.use(attachAuth(auth));

  root.use('/api', createApiRouter());

  // หน้าเข้าสู่ระบบ + ไฟล์ประกอบของหน้าเข้าสู่ระบบ — เข้าถึงได้โดยไม่ต้องล็อกอิน
  root.get(['/login', '/login.html'], (_req, res) => {
    sendHtml(res, path.join(publicDir, 'login.html'));
  });
  root.get('/login.css', (_req, res) => {
    res.sendFile(path.join(publicDir, 'login.css'));
  });
  root.get('/login.js', (_req, res) => {
    res.sendFile(path.join(publicDir, 'login.js'));
  });

  // หน้าเว็บที่เหลือทั้งหมด — ต้องล็อกอินก่อน (ไม่ล็อกอินจะถูกส่งไปหน้า /login)
  root.use(requireAuthPage(auth, base));
  root.use(express.static(publicDir));
  root.get(/^\/(?!api).*/, (_req, res) => {
    sendHtml(res, path.join(publicDir, 'index.html'));
  });

  root.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error(`[web] ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  });

  // ===== mount ทั้งหมดไว้ใต้ base path (ถ้ามี) =====
  if (base) {
    // ถ้าเข้ามาที่ /SyncJOB เปล่า ๆ (ไม่มี slash ท้าย) ให้ redirect ไป /SyncJOB/ ให้เป็นมาตรฐาน
    // ใช้ middleware + เทียบ path แบบตรงตัว เพราะ app.get() จะจับ /SyncJOB/ ด้วย (เกิด loop ได้)
    app.use((req, res, next) => {
      if (req.path === base) {
        // ใช้ 302 + ไม่ cache เพื่อไม่ให้เบราว์เซอร์จำ redirect ไว้ตอนเปลี่ยน APP_BASE_PATH
        res.set('Cache-Control', 'no-store');
        res.redirect(302, `${base}/`);
        return;
      }
      next();
    });
    app.use(base, root);
  } else {
    app.use(root);
  }

  return app;
}

export async function startServer(port: number = env.APP_PORT, host: string = env.APP_HOST): Promise<void> {
  const app = createApp();
  const base = basePath();
  await new Promise<void>((resolve) => {
    const server = app.listen(port, host, () => {
      const auth = getAuthService();
      logger.info(`Web UI พร้อมใช้งาน → http://${host}:${port}${base}/`);
      logger.info(
        auth.enabled
          ? `ระบบล็อกอิน: เปิดใช้งาน (ตารางผู้ใช้ "${env.AUTH_USERS_TABLE}")`
          : 'ระบบล็อกอิน: ปิดใช้งาน (APP_AUTH_ENABLED=false) — ไม่ควรเปิดสู่อินเทอร์เน็ต',
      );
      if (base) logger.info(`ติดตั้งใต้โฟลเดอร์ย่อย: ${base}/`);
      resolve();
    });
    server.on('error', (err) => {
      logger.error(`เปิดพอร์ต ${port} ไม่สำเร็จ: ${err.message}`);
      process.exit(1);
    });
  });
}
