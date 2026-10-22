import type { NextFunction, Request, Response } from 'express';
import { parseCookies, SESSION_COOKIE, type SessionUser } from './session';
import type { AuthService } from './service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** ผู้ใช้ที่ล็อกอินอยู่ (null = ยังไม่ล็อกอิน) */
      authUser?: SessionUser | null;
    }
  }
}

/** ระบุตัวผู้เรียก (ใช้นับจำนวนครั้งที่ login ผิด) */
export function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** ตรวจว่า request มาทาง HTTPS หรือไม่ (รองรับ reverse proxy) */
export function isSecureRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string') {
    return proto.split(',')[0].trim().toLowerCase() === 'https';
  }
  return false;
}

/**
 * อ่าน session จาก cookie แล้วแนบข้อมูลผู้ใช้ไว้ใน request
 * ต้องเรียกก่อน requireAuth / requireRole
 */
export function attachAuth(auth: AuthService) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const cookies = parseCookies(req.headers.cookie);
    req.authUser = auth.currentUser(cookies[SESSION_COOKIE]);
    next();
  };
}

/** บังคับล็อกอินสำหรับ API — ตอบ 401 ถ้ายังไม่ล็อกอิน */
export function requireAuth(auth: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!auth.enabled || req.authUser) {
      next();
      return;
    }
    res.status(401).json({ ok: false, error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน', authRequired: true });
  };
}

/** บังคับล็อกอินสำหรับหน้าเว็บ — redirect ไปหน้า /login */
export function requireAuthPage(auth: AuthService, basePath = '') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!auth.enabled || req.authUser) {
      next();
      return;
    }
    res.redirect(302, `${basePath}/login`);
  };
}

/** ต้องมีบทบาทที่ระบุ (เช่น ADMIN) */
export function requireRole(auth: AuthService, role: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!auth.enabled) {
      next();
      return;
    }
    const current = req.authUser?.role?.toUpperCase();
    if (current === role.toUpperCase()) {
      next();
      return;
    }
    res.status(403).json({ ok: false, error: `ต้องมีสิทธิ์ ${role} เท่านั้น` });
  };
}
