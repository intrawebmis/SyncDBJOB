import { describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service';
import { hashPassword } from '../src/auth/password';
import type { DbAdapter, ExecuteResult } from '../src/core/types';

interface UserRow {
  USER_ID: number;
  USERNAME: string;
  PASSWORD_HASH: string;
  FULL_NAME: string | null;
  ROLE: string;
  USER_ACTIVE: number;
}

/** Fake DB ที่ตอบคำถาม SELECT ... FROM `newfin_users` WHERE USERNAME = ? */
function makeUserDb(users: UserRow[], options: { fail?: boolean } = {}): DbAdapter {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T> {
      if (options.fail) throw new Error('connection lost');
      if (!/newfin_users/i.test(sql)) return [] as T;
      const wanted = String(params[0] ?? '').toLowerCase();
      const found = users.filter((u) => u.USERNAME.toLowerCase() === wanted);
      return found as unknown as T;
    },
    async execute<T>(): Promise<ExecuteResult<T>> {
      return { rows: [], affectedRows: 0, changedRows: 0, insertId: 0 };
    },
    async beginTransaction(): Promise<void> {},
    async commit(): Promise<void> {},
    async rollback(): Promise<void> {},
    async end(): Promise<void> {},
  };
}

async function makeService(
  users: UserRow[],
  overrides: Partial<ConstructorParameters<typeof AuthService>[0]> = {},
) {
  const auth = new AuthService({
    enabled: true,
    secret: 'unit-test-secret',
    usersTable: 'newfin_users',
    dbProvider: () => makeUserDb(users),
    ...overrides,
  });
  return auth;
}

describe('AuthService.login', () => {
  it('ล็อกอินสำเร็จด้วยรหัสผ่านที่ถูกต้อง', async () => {
    const hash = await hashPassword('admin123');
    const auth = await makeService([
      {
        USER_ID: 1,
        USERNAME: 'admin',
        PASSWORD_HASH: hash,
        FULL_NAME: 'ผู้ดูแลระบบ',
        ROLE: 'ADMIN',
        USER_ACTIVE: 1,
      },
    ]);

    const result = await auth.login('admin', 'admin123', '127.0.0.1');
    expect(result.ok).toBe(true);
    expect(result.user?.username).toBe('admin');
    expect(result.user?.role).toBe('ADMIN');
    expect(result.cookieValue).toBeTruthy();

    // ใช้ cookie ที่ได้กลับไปอ่าน session ได้
    const session = auth.currentUser(result.cookieValue);
    expect(session?.fullName).toBe('ผู้ดูแลระบบ');
  });

  it('รหัสผ่านผิดต้องไม่ให้ผ่าน', async () => {
    const hash = await hashPassword('admin123');
    const auth = await makeService([
      {
        USER_ID: 1,
        USERNAME: 'admin',
        PASSWORD_HASH: hash,
        FULL_NAME: null,
        ROLE: 'ADMIN',
        USER_ACTIVE: 1,
      },
    ]);

    const result = await auth.login('admin', 'wrong', '127.0.0.1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ไม่ถูกต้อง');
    expect(result.cookieValue).toBeUndefined();
  });

  it('ไม่พบผู้ใช้ต้องข้อความเดียวกับรหัสผ่านผิด (กันการเดาชื่อผู้ใช้)', async () => {
    const hash = await hashPassword('admin123');
    const auth = await makeService([
      {
        USER_ID: 1,
        USERNAME: 'admin',
        PASSWORD_HASH: hash,
        FULL_NAME: null,
        ROLE: 'ADMIN',
        USER_ACTIVE: 1,
      },
    ]);

    const notFound = await auth.login('nobody', 'admin123', '127.0.0.1');
    const wrongPass = await auth.login('admin', 'nope', '127.0.0.1');
    expect(notFound.ok).toBe(false);
    expect(notFound.error).toBe(wrongPass.error);
  });

  it('บัญชีที่ถูกปิดใช้งานต้องล็อกอินไม่ได้', async () => {
    const hash = await hashPassword('admin123');
    const auth = await makeService([
      {
        USER_ID: 1,
        USERNAME: 'admin',
        PASSWORD_HASH: hash,
        FULL_NAME: null,
        ROLE: 'ADMIN',
        USER_ACTIVE: 0,
      },
    ]);

    const result = await auth.login('admin', 'admin123', '127.0.0.1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ปิดใช้งาน');
  });

  it('ต้องกรอกทั้งชื่อผู้ใช้และรหัสผ่าน', async () => {
    const auth = await makeService([]);
    expect((await auth.login('', '', 'ip')).ok).toBe(false);
    expect((await auth.login('admin', '', 'ip')).ok).toBe(false);
    expect((await auth.login('', 'pass', 'ip')).ok).toBe(false);
  });

  it('ล็อกบัญชีชั่วคราวเมื่อล้มเหลวเกินจำนวนที่กำหนด', async () => {
    const hash = await hashPassword('admin123');
    const auth = await makeService(
      [
        {
          USER_ID: 1,
          USERNAME: 'admin',
          PASSWORD_HASH: hash,
          FULL_NAME: null,
          ROLE: 'ADMIN',
          USER_ACTIVE: 1,
        },
      ],
      { maxAttempts: 3, lockMinutes: 15 },
    );

    for (let i = 0; i < 3; i += 1) {
      const r = await auth.login('admin', 'bad', '1.1.1.1');
      expect(r.ok).toBe(false);
    }

    // ครั้งที่ 4 จะถูกล็อกแม้ว่ารหัสผ่านถูกต้อง
    const locked = await auth.login('admin', 'admin123', '1.1.1.1');
    expect(locked.ok).toBe(false);
    expect(locked.lockedUntil).toBeTruthy();

    // คนละ IP ไม่ถูกล็อก
    const other = await auth.login('admin', 'admin123', '2.2.2.2');
    expect(other.ok).toBe(true);
  });

  it('ล็อกอินสำเร็จแล้วเคลียร์จำนวนครั้งที่ล้มเหลว', async () => {
    const hash = await hashPassword('admin123');
    const auth = await makeService(
      [
        {
          USER_ID: 1,
          USERNAME: 'admin',
          PASSWORD_HASH: hash,
          FULL_NAME: null,
          ROLE: 'ADMIN',
          USER_ACTIVE: 1,
        },
      ],
      { maxAttempts: 3, lockMinutes: 15 },
    );

    await auth.login('admin', 'bad1', 'ip');
    await auth.login('admin', 'bad2', 'ip');
    expect((await auth.login('admin', 'admin123', 'ip')).ok).toBe(true);
    await auth.login('admin', 'bad3', 'ip');
    // นับใหม่จาก 1 → ยังไม่ถึง 3 ครั้ง
    expect((await auth.login('admin', 'admin123', 'ip')).ok).toBe(true);
  });

  it('ฐานข้อมูลมีปัญหาต้องแจ้งว่าระบบขัดข้อง (ไม่ใช่รหัสผ่านผิด)', async () => {
    const auth = new AuthService({
      enabled: true,
      secret: 'unit-test-secret',
      usersTable: 'newfin_users',
      dbProvider: () => makeUserDb([], { fail: true }),
    });

    const result = await auth.login('admin', 'admin123', 'ip');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ขัดข้อง');
  });

  it('ปิดระบบล็อกอินไว้จะล็อกอินได้เสมอ', async () => {
    const auth = new AuthService({ enabled: false, secret: 'x' });
    const result = await auth.login(' anyone ', 'whatever', 'ip');
    expect(result.ok).toBe(true);
    expect(result.user?.role).toBe('ADMIN');
    expect(auth.currentUser(result.cookieValue)).toBeNull();
  });
});

describe('AuthService.logout', () => {
  it('ยกเลิก session หลังล็อกเอาต์', async () => {
    const hash = await hashPassword('admin123');
    const auth = await makeService([
      {
        USER_ID: 1,
        USERNAME: 'admin',
        PASSWORD_HASH: hash,
        FULL_NAME: null,
        ROLE: 'ADMIN',
        USER_ACTIVE: 1,
      },
    ]);

    const result = await auth.login('admin', 'admin123', 'ip');
    expect(auth.currentUser(result.cookieValue)).not.toBeNull();
    auth.logout(result.cookieValue);
    expect(auth.currentUser(result.cookieValue)).toBeNull();
  });
});
