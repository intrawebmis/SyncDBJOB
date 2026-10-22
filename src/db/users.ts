import type { DbAdapter } from '../core/types';
import { quoteIdent } from '../core/upsert';
import { logger } from '../utils/logger';

export interface AuthUser {
  id: number;
  username: string;
  passwordHash: string;
  fullName: string | null;
  role: string;
  active: boolean;
}

/**
 * ตรวจสอบว่าชื่อตารางผู้ใช้เป็น identifier ที่ปลอดภัย
 * (กัน SQL injection ในกรณีที่นำค่าจาก .env มาใช้)
 */
export function assertSafeIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`ชื่อตารางผู้ใช้ไม่ถูกต้อง: "${name}" (ต้องเป็นชื่อตารางธรรมดา)`);
  }
  return name;
}

/**
 * หาผู้ใช้จากชื่อผู้ใช้ (ไม่สนใจว่า active หรือไม่ — ให้ผู้เรียกตัดสินใจ)
 */
export async function findUserByUsername(
  db: DbAdapter,
  table: string,
  username: string,
): Promise<AuthUser | null> {
  const t = assertSafeIdentifier(table);
  const rows = await db.query<Array<Record<string, unknown>>>(
    `SELECT USER_ID, USERNAME, PASSWORD_HASH, FULL_NAME, ROLE, USER_ACTIVE
       FROM ${quoteIdent(t)}
      WHERE USERNAME = ?
      LIMIT 1`,
    [username],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.USER_ID),
    username: String(row.USERNAME),
    passwordHash: String(row.PASSWORD_HASH ?? ''),
    fullName: row.FULL_NAME === null || row.FULL_NAME === undefined ? null : String(row.FULL_NAME),
    role: String(row.ROLE ?? 'USER'),
    active: Number(row.USER_ACTIVE ?? 0) === 1,
  };
}

/** นับผู้ใช้ที่ active ในตาราง */
export async function countActiveUsers(db: DbAdapter, table: string): Promise<number> {
  const t = assertSafeIdentifier(table);
  try {
    const rows = await db.query<Array<{ c: number }>>(
      `SELECT COUNT(*) AS c FROM ${quoteIdent(t)} WHERE USER_ACTIVE = 1`,
    );
    return Number(rows[0]?.c ?? 0);
  } catch (err) {
    logger.warn('นับผู้ใช้ไม่สำเร็จ', (err as Error).message);
    return 0;
  }
}

/** แสดงรายชื่อผู้ใช้ทั้งหมดในตาราง */
export async function listUsers(db: DbAdapter, table: string): Promise<AuthUser[]> {
  const t = assertSafeIdentifier(table);
  const rows = await db.query<Array<Record<string, unknown>>>(
    `SELECT USER_ID, USERNAME, PASSWORD_HASH, FULL_NAME, ROLE, USER_ACTIVE
       FROM ${quoteIdent(t)}
      ORDER BY USER_ID`,
  );
  return rows.map((row) => ({
    id: Number(row.USER_ID),
    username: String(row.USERNAME),
    passwordHash: String(row.PASSWORD_HASH ?? ''),
    fullName: row.FULL_NAME === null || row.FULL_NAME === undefined ? null : String(row.FULL_NAME),
    role: String(row.ROLE ?? 'USER'),
    active: Number(row.USER_ACTIVE ?? 0) === 1,
  }));
}

/**
 * เพิ่มผู้ใช้ใหม่ หรืออัปเดตรหัสผ่าน/ข้อมูลของผู้ใช้ที่มีอยู่แล้ว
 * คืนค่า 'created' หรือ 'updated'
 */
export async function upsertUser(
  db: DbAdapter,
  table: string,
  data: {
    username: string;
    passwordHash: string;
    fullName?: string | null;
    role?: string;
    active?: boolean;
  },
): Promise<'created' | 'updated'> {
  const t = assertSafeIdentifier(table);
  const existing = await findUserByUsername(db, t, data.username);

  if (existing) {
    await db.execute(
      `UPDATE ${quoteIdent(t)}
          SET PASSWORD_HASH = ?,
              FULL_NAME = ?,
              ROLE = ?,
              USER_ACTIVE = ?
        WHERE USER_ID = ?`,
      [
        data.passwordHash,
        data.fullName ?? existing.fullName,
        data.role ?? existing.role,
        (data.active ?? existing.active) ? 1 : 0,
        existing.id,
      ],
    );
    return 'updated';
  }

  await db.execute(
    `INSERT INTO ${quoteIdent(t)}
       (USERNAME, PASSWORD_HASH, FULL_NAME, ROLE, USER_ACTIVE)
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.username,
      data.passwordHash,
      data.fullName ?? null,
      data.role ?? 'USER',
      (data.active ?? true) ? 1 : 0,
    ],
  );
  return 'created';
}

/** เปิด/ปิดการใช้งานบัญชี */
export async function setUserActive(
  db: DbAdapter,
  table: string,
  username: string,
  active: boolean,
): Promise<boolean> {
  const t = assertSafeIdentifier(table);
  const existing = await findUserByUsername(db, t, username);
  if (!existing) return false;
  await db.execute(`UPDATE ${quoteIdent(t)} SET USER_ACTIVE = ? WHERE USER_ID = ?`, [
    active ? 1 : 0,
    existing.id,
  ]);
  return true;
}

/** ลบผู้ใช้ออกจากตาราง */
export async function removeUser(db: DbAdapter, table: string, username: string): Promise<boolean> {
  const t = assertSafeIdentifier(table);
  const existing = await findUserByUsername(db, t, username);
  if (!existing) return false;
  await db.execute(`DELETE FROM ${quoteIdent(t)} WHERE USER_ID = ?`, [existing.id]);
  return true;
}
