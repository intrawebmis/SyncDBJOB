import { timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

/** จำนวนรอบ (cost factor) ของ bcrypt */
export const BCRYPT_ROUNDS = 10;

/** bcrypt hash ของ MySQL/MariaDB จะขึ้นต้นด้วย $2a$ / $2b$ / $2y$ */
const BCRYPT_PATTERN = /^\$2[aby]?\$\d{2}\$/;

/** เปรียบเทียบสตริงแบบคงเวลา (กัน timing attack) */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // ยังเทียบเพื่อให้เวลาคงที่ แต่คืน false
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * เข้ารหัสรหัสผ่านด้วย bcrypt
 * รูปแบบที่เก็บ: $2b$10$<salt><hash>
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * ตรวจสอบรหัสผ่าน
 * รองรับ 2 แบบ:
 *  1. bcrypt hash  ($2a$10$... / $2b$10$...) — รูปแบบที่ newfin_users ใช้
 *  2. ข้อความธรรมดา — สำหรับระบบเก่าที่ยังไม่ได้เข้ารหัส
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (BCRYPT_PATTERN.test(stored)) {
    try {
      return await bcrypt.compare(plain, stored);
    } catch {
      return false;
    }
  }
  return safeEqual(plain, stored);
}

/** bcrypt hash นี้ใช้ได้กับระบบนี้หรือไม่ */
export function isBcryptHash(stored: string): boolean {
  return BCRYPT_PATTERN.test(stored);
}
