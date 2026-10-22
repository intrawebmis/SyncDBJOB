import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { env } from '../config/env';
import { createAdapter } from '../db/client';
import { getPool } from '../db/pool';
import { countActiveUsers, findUserByUsername, type AuthUser } from '../db/users';
import type { DbAdapter } from '../core/types';
import { storageRoot } from '../store/mappings';
import { logger } from '../utils/logger';
import { verifyPassword } from './password';
import { SessionStore, type SessionUser } from './session';

/** hash ปลอมๆ ที่ใช้เทียบเวลา เพื่อไม่ให้รู้ว่าชื่อผู้ใช้มีอยู่จริงหรือไม่ */
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export interface LoginResult {
  ok: boolean;
  user?: SessionUser;
  error?: string;
  /** ค่า cookie ของ session ที่สร้างใหม่ (มีเมื่อล็อกอินสำเร็จ) */
  cookieValue?: string;
  /** เวลาที่ถูกล็อกจนถึง (timestamp) — มีเมื่อถูกล็อก */
  lockedUntil?: number;
}

/**
 * คีย์สำหรับเซ็น cookie
 * - ถ้าตั้ง APP_SESSION_SECRET ไว้ ใช้ค่านั้น
 * - ถ้าไม่ได้ตั้ง จะสร้างคีย์ใหม่แล้วบันทึกไว้ใน storage/.session-secret
 *   (เพื่อให้ session ยังใช้ได้หลัง restart เซิร์ฟเวอร์)
 */
export function resolveSessionSecret(): string {
  const fromEnv = env.APP_SESSION_SECRET.trim();
  if (fromEnv) return fromEnv;

  const file = path.join(storageRoot, '.session-secret');
  try {
    if (fs.existsSync(file)) {
      const value = fs.readFileSync(file, 'utf8').trim();
      if (value) return value;
    }
    const generated = randomBytes(32).toString('base64url');
    fs.mkdirSync(storageRoot, { recursive: true });
    fs.writeFileSync(file, generated, { encoding: 'utf8', mode: 0o600 });
    logger.warn('สร้าง APP_SESSION_SECRET ใหม่แล้ว (บันทึกที่ storage/.session-secret)');
    return generated;
  } catch (err) {
    logger.warn('บันทึก APP_SESSION_SECRET ไม่สำเร็จ — session จะหมดอายุเมื่อ restart', (err as Error).message);
    return randomBytes(32).toString('base64url');
  }
}

export interface AuthServiceOptions {
  /** ชื่อตารางผู้ใช้ */
  usersTable?: string;
  /** จำนวนครั้งที่ล้มเหลวได้ก่อนถูกล็อก */
  maxAttempts?: number;
  /** เวลาล็อก (นาที) */
  lockMinutes?: number;
  /** อายุ session (ชั่วโมง) */
  ttlHours?: number;
  /** เปิด/ปิดระบบล็อกอิน */
  enabled?: boolean;
  /** คีย์เซ็น cookie (สำหรับเทสต์) */
  secret?: string;
  /** ตัวดึงข้อมูลจากฐานข้อมูล (สำหรับเทสต์) */
  dbProvider?: () => DbAdapter;
}

/**
 * ระบบล็อกอิน
 *
 * อ่านผู้ใช้จากตารางผู้ใช้ในฐานข้อมูล (ค่าเริ่มต้น `newfin_users`)
 * รหัสผ่านเก็บเป็น bcrypt hash ในคอลัมน์ PASSWORD_HASH
 */
export class AuthService {
  readonly sessions: SessionStore;
  readonly enabled: boolean;

  /** บันทึกความล้มเหลวของการล็อกอิน เพื่อจำกัดการเดารหัสผ่าน */
  private readonly failures = new Map<string, { count: number; firstAt: number }>();

  private readonly usersTable: string;
  private readonly maxAttempts: number;
  private readonly lockMinutes: number;
  private readonly dbProvider: () => DbAdapter;

  constructor(options: AuthServiceOptions = {}) {
    this.enabled = options.enabled ?? env.APP_AUTH_ENABLED;
    this.usersTable = options.usersTable ?? env.AUTH_USERS_TABLE;
    this.maxAttempts = options.maxAttempts ?? env.APP_LOGIN_MAX_ATTEMPTS;
    this.lockMinutes = options.lockMinutes ?? env.APP_LOGIN_LOCK_MINUTES;
    const ttlHours = options.ttlHours ?? env.APP_SESSION_TTL_HOURS;
    this.dbProvider = options.dbProvider ?? (() => createAdapter(getPool()));
    this.sessions = new SessionStore(
      options.secret ?? resolveSessionSecret(),
      ttlHours * 60 * 60 * 1000,
    );
  }

  /** ผู้ใช้ที่ล็อกอินอยู่ (null = ยังไม่ล็อกอิน) */
  currentUser(cookieValue: string | undefined | null): SessionUser | null {
    if (!this.enabled) return null;
    return this.sessions.read(cookieValue)?.user ?? null;
  }

  /** ล็อกอิน */
  async login(username: string, password: string, client = ''): Promise<LoginResult> {
    if (!this.enabled) {
      return { ok: true, user: { username: 'local', fullName: 'ผู้ใช้ในเครื่อง', role: 'ADMIN' } };
    }

    const name = String(username ?? '').trim();
    if (!name || !password) {
      return { ok: false, error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };
    }

    const key = `${name.toLowerCase()}|${client}`;
    const lockedUntil = this.lockedUntil(key);
    if (lockedUntil) {
      return {
        ok: false,
        error: `เข้าสู่ระบบไม่สำเร็จหลายครั้ง กรุณารอ ${Math.ceil((lockedUntil - Date.now()) / 60000)} นาที`,
        lockedUntil,
      };
    }

    const db = this.dbProvider();
    let user: AuthUser | null = null;
    try {
      user = await findUserByUsername(db, this.usersTable, name);
    } catch (err) {
      logger.error(`[auth] อ่านตารางผู้ใช้ "${this.usersTable}" ไม่สำเร็จ`, (err as Error).message);
      return { ok: false, error: 'ระบบล็อกอินขัดข้อง กรุณาติดต่อผู้ดูแลระบบ' };
    } finally {
      await db.end();
    }

    if (!user) {
      // เทียบเวลากับ hash ปลอม เพื่อไม่ให้รู้ว่าชื่อผู้ใช้นี้มีอยู่จริงหรือไม่
      await verifyPassword(password, DUMMY_HASH);
      this.recordFailure(key);
      return { ok: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      this.recordFailure(key);
      return { ok: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    }

    if (!user.active) {
      return { ok: false, error: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ' };
    }

    this.failures.delete(key);

    const sessionUser: SessionUser = {
      username: user.username,
      fullName: user.fullName,
      role: user.role || 'USER',
    };
    const { cookieValue } = this.sessions.create(sessionUser);
    logger.info(`[auth] ล็อกอินสำเร็จ: ${user.username} (${sessionUser.role})`);

    return { ok: true, user: sessionUser, cookieValue };
  }

  /** ล็อกเอาต์ */
  logout(cookieValue: string | undefined | null): void {
    this.sessions.destroy(cookieValue);
  }

  /** จำนวนผู้ใช้ที่ active ในตาราง (ใช้ตรวจว่าระบบพร้อมใช้งานไหม) */
  async activeUserCount(): Promise<number> {
    const db = this.dbProvider();
    try {
      return await countActiveUsers(db, this.usersTable);
    } catch {
      return 0;
    } finally {
      await db.end();
    }
  }

  /**
   * ตรวจว่าถูกล็อกอยู่หรือไม่
   * คืนค่าเวลาที่ปลดล็อก (timestamp) หรือ null ถ้าไม่ได้ถูกล็อก
   */
  private lockedUntil(key: string): number | null {
    const entry = this.failures.get(key);
    if (!entry) return null;

    const windowMs = this.lockMinutes * 60 * 1000;
    if (Date.now() - entry.firstAt > windowMs) {
      // หมดช่วงเวลานับความล้มเหลวแล้ว — เริ่มนับใหม่
      this.failures.delete(key);
      return null;
    }
    if (entry.count < this.maxAttempts) return null;
    return entry.firstAt + windowMs;
  }

  private recordFailure(key: string): void {
    const now = Date.now();
    const windowMs = this.lockMinutes * 60 * 1000;
    const entry = this.failures.get(key);

    if (!entry || now - entry.firstAt > windowMs) {
      this.failures.set(key, { count: 1, firstAt: now });
      return;
    }

    entry.count += 1;
    if (entry.count >= this.maxAttempts) {
      logger.warn(`[auth] ล็อกการล็อกอินชั่วคราว: ${key.split('|')[0]}`);
    }
  }
}

let service: AuthService | null = null;

/** ตัวอย่างระบบล็อกอินของทั้งระบบ (ใช้ร่วมกันทุก request) */
export function getAuthService(): AuthService {
  if (!service) service = new AuthService();
  return service;
}
