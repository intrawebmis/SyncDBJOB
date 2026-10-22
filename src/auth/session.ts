import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** ชื่อ cookie ที่เก็บ session */
export const SESSION_COOKIE = 'sdj_session';

export interface SessionUser {
  username: string;
  fullName: string | null;
  role: string;
}

export interface Session {
  id: string;
  user: SessionUser;
  createdAt: number;
  expiresAt: number;
}

/** แปลง cookie header เป็น object (ไม่ต้องใช้ dependency เพิ่ม) */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * คลัง session แบบอยู่ในหน่วยความจำ
 *
 * ค่าใน cookie จะถูก "เซ็น" ด้วย HMAC-SHA256 เพื่อไม่ให้ใครเดา/ปลอมค่า session id ได้
 * รูปแบบ: <sessionId>.<signature>
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly secret: string,
    private readonly ttlMs: number,
  ) {}

  /** สร้าง session ใหม่ คืนค่า session และค่า cookie ที่พร้อมใช้ */
  create(user: SessionUser): { session: Session; cookieValue: string } {
    // เก็บกวาด session ที่หมดอายุทิ้งเมื่อสะสมมาก ๆ เพื่อไม่ให้หน่วยความจำขยะเพิ่มเรื่อย ๆ
    if (this.sessions.size > 1000) this.prune();

    const id = randomBytes(32).toString('base64url');
    const now = Date.now();
    const session: Session = {
      id,
      user,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.sessions.set(id, session);
    return { session, cookieValue: this.sign(id) };
  }

  /** อ่าน session จากค่า cookie — คืน null ถ้าไม่ถูกต้องหรือหมดอายุ */
  read(cookieValue: string | undefined | null): Session | null {
    if (!cookieValue) return null;
    const dot = cookieValue.lastIndexOf('.');
    if (dot <= 0) return null;

    const id = cookieValue.slice(0, dot);
    const signature = cookieValue.slice(dot + 1);

    if (!this.verifySignature(id, signature)) return null;

    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  /** ยกเลิก session */
  destroy(cookieValue: string | undefined | null): void {
    if (!cookieValue) return;
    const dot = cookieValue.lastIndexOf('.');
    if (dot <= 0) return;
    this.sessions.delete(cookieValue.slice(0, dot));
  }

  /** ลบ session ที่หมดอายุ (เรียกเป็นระยะ) */
  prune(): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /** จำนวน session ที่ยังใช้งานอยู่ */
  get size(): number {
    return this.sessions.size;
  }

  /** เซ็นค่า session id */
  private sign(id: string): string {
    const mac = createHmac('sha256', this.secret).update(id).digest();
    return `${id}.${base64url(mac)}`;
  }

  /** ตรวจลายเซ็น */
  private verifySignature(id: string, signature: string): boolean {
    const expected = createHmac('sha256', this.secret).update(id).digest();
    let given: Buffer;
    try {
      given = Buffer.from(signature, 'base64url');
    } catch {
      return false;
    }
    if (given.length !== expected.length) return false;
    return timingSafeEqual(given, expected);
  }
}

/** สร้าง cookie สำหรับตั้งค่าใน response */
export function buildSessionCookie(
  value: string,
  options: { maxAgeMs: number; secure: boolean },
): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(options.maxAgeMs / 1000)}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/** cookie สำหรับลบ session */
export function clearSessionCookie(secure: boolean): string {
  const parts = [ `${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0' ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
