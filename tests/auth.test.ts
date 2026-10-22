import { describe, expect, it } from 'vitest';
import { hashPassword, isBcryptHash, safeEqual, verifyPassword } from '../src/auth/password';
import {
  buildSessionCookie,
  clearSessionCookie,
  parseCookies,
  SESSION_COOKIE,
  SessionStore,
} from '../src/auth/session';
import { assertSafeIdentifier } from '../src/db/users';

const SECRET = 'test-secret-key-123';

describe('password', () => {
  it('เข้ารหัสและตรวจสอบ bcrypt ได้', async () => {
    const hash = await hashPassword('s3cret-pass');
    expect(isBcryptHash(hash)).toBe(true);
    expect(hash).not.toContain('s3cret-pass');
    expect(await verifyPassword('s3cret-pass', hash)).toBe(true);
    expect(await verifyPassword('wrong-pass', hash)).toBe(false);
  });

  it('รองรับ hash รูปแบบ $2a$ (ที่เก็บใน newfin_users)', async () => {
    const hash = (await hashPassword('admin123')).replace('$2b$', '$2a$');
    expect(isBcryptHash(hash)).toBe(true);
    expect(await verifyPassword('admin123', hash)).toBe(true);
    expect(await verifyPassword('admin124', hash)).toBe(false);
  });

  it('รองรับรหัสผ่านแบบเข้ารหัสเก่า (ข้อความธรรมดา)', async () => {
    expect(await verifyPassword('plainpass', 'plainpass')).toBe(true);
    expect(await verifyPassword('plainpass', 'plainpas')).toBe(false);
    expect(await verifyPassword('plainpass', '')).toBe(false);
  });

  it('hash ที่เสียหายต้องไม่ทำให้ระบบพัง', async () => {
    expect(await verifyPassword('x', '$2a$10$broken')).toBe(false);
  });

  it('safeEqual เทียบแบบคงเวลา', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('parseCookies', () => {
  it('อ่าน cookie header ได้', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
  });

  it('รองรับค่าที่เข้ารหัส url', () => {
    expect(parseCookies('x=a%20b')).toEqual({ x: 'a b' });
  });

  it('คืนค่าว่างเมื่อไม่มี header', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });
});

describe('SessionStore', () => {
  it('สร้างและอ่าน session ได้', () => {
    const store = new SessionStore(SECRET, 60_000);
    const { cookieValue, session } = store.create({
      username: 'admin',
      fullName: 'ผู้ดูแล',
      role: 'ADMIN',
    });

    expect(cookieValue).toContain('.');
    expect(session.user.username).toBe('admin');

    const read = store.read(cookieValue);
    expect(read).not.toBeNull();
    expect(read?.user.role).toBe('ADMIN');
    expect(store.size).toBe(1);
  });

  it('ปฏิเสธค่า cookie ที่ถูกแก้ไข (ลายเซ็นไม่ตรง)', () => {
    const store = new SessionStore(SECRET, 60_000);
    const { cookieValue } = store.create({ username: 'admin', fullName: null, role: 'ADMIN' });

    const dot = cookieValue.lastIndexOf('.');
    const tampered = cookieValue.slice(0, dot) + '.' + cookieValue.slice(dot + 1).replace(/^./, 'x');

    expect(store.read(tampered)).toBeNull();
  });

  it('ปฏิเสธค่า session ที่เซ็นด้วยคีย์อื่น', () => {
    const storeA = new SessionStore(SECRET, 60_000);
    const storeB = new SessionStore('another-secret', 60_000);
    const { cookieValue } = storeA.create({ username: 'admin', fullName: null, role: 'ADMIN' });

    expect(storeB.read(cookieValue)).toBeNull();
  });

  it('session หมดอายุต้องอ่านไม่ได้', () => {
    const store = new SessionStore(SECRET, -1);
    const { cookieValue } = store.create({ username: 'admin', fullName: null, role: 'ADMIN' });
    expect(store.read(cookieValue)).toBeNull();
  });

  it('destroy ยกเลิก session ได้', () => {
    const store = new SessionStore(SECRET, 60_000);
    const { cookieValue } = store.create({ username: 'admin', fullName: null, role: 'ADMIN' });
    store.destroy(cookieValue);
    expect(store.read(cookieValue)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('prune ลบ session ที่หมดอายุ', () => {
    const store = new SessionStore(SECRET, -1);
    store.create({ username: 'a', fullName: null, role: 'USER' });
    store.create({ username: 'b', fullName: null, role: 'USER' });
    expect(store.prune()).toBe(2);
    expect(store.size).toBe(0);
  });

  it('ค่าที่ไม่ใช่ cookie ต้องไม่ทำให้ระบบพัง', () => {
    const store = new SessionStore(SECRET, 60_000);
    expect(store.read(undefined)).toBeNull();
    expect(store.read('')).toBeNull();
    expect(store.read('no-dot-here')).toBeNull();
    expect(store.read('.onlysig')).toBeNull();
  });
});

describe('cookie helpers', () => {
  it('สร้าง cookie พร้อม HttpOnly / SameSite', () => {
    const cookie = buildSessionCookie('abc.def', { maxAgeMs: 3_600_000, secure: false });
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=3600');
    expect(cookie).not.toContain('Secure');
  });

  it('ใส่ Secure เมื่อใช้ผ่าน HTTPS', () => {
    const cookie = buildSessionCookie('abc.def', { maxAgeMs: 1000, secure: true });
    expect(cookie).toContain('Secure');
  });

  it('ลบ cookie ด้วย Max-Age=0', () => {
    expect(clearSessionCookie(false)).toContain('Max-Age=0');
  });
});

describe('assertSafeIdentifier', () => {
  it('ยอมรับชื่อตารางที่ถูกต้อง', () => {
    expect(assertSafeIdentifier('newfin_users')).toBe('newfin_users');
    expect(assertSafeIdentifier('Users2')).toBe('Users2');
  });

  it('ปฏิเสธชื่อที่อาจเป็น SQL injection', () => {
    expect(() => assertSafeIdentifier('users; DROP TABLE x')).toThrow();
    expect(() => assertSafeIdentifier('users`')).toThrow();
    expect(() => assertSafeIdentifier('')).toThrow();
    expect(() => assertSafeIdentifier('1abc')).toThrow();
  });
});
