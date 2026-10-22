import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * ทดสอบการติดตั้งแอปใต้โฟลเดอร์ย่อย (sub-path)
 * เช่น https://ebcitrade.com/SyncJOB/ → APP_BASE_PATH=/SyncJOB
 */

interface Running {
  url: string;
  close: () => Promise<void>;
}

const running: Running[] = [];

async function startApp(basePath: string): Promise<Running> {
  process.env.APP_BASE_PATH = basePath;
  process.env.APP_AUTH_ENABLED = 'true';
  vi.resetModules();

  const { createApp } = await import('../src/server');
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as AddressInfo).port;

  const handle: Running = {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
  running.push(handle);
  return handle;
}

afterEach(async () => {
  while (running.length) {
    const item = running.pop();
    if (item) await item.close();
  }
  vi.resetModules();
});

describe('ติดตั้งที่ root (APP_BASE_PATH ว่าง)', () => {
  it('หน้าเว็บ redirect ไป /login และ API ตอบ 401 เมื่อยังไม่ล็อกอิน', async () => {
    const { url } = await startApp('');

    const root = await fetch(`${url}/`, { redirect: 'manual' });
    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe('/login');

    const login = await fetch(`${url}/login`);
    expect(login.status).toBe(200);

    const health = await fetch(`${url}/api/health`);
    expect(health.status).toBe(200);

    const tables = await fetch(`${url}/api/tables`);
    expect(tables.status).toBe(401);
  });
});

describe('ติดตั้งใต้โฟลเดอร์ย่อย (APP_BASE_PATH=/SyncJOB)', () => {
  it('ทุก URL ต้องอยู่ใต้ /SyncJOB และไม่หลุดออกมา', async () => {
    const { url } = await startApp('/SyncJOB');

    const root = await fetch(`${url}/SyncJOB/`, { redirect: 'manual' });
    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe('/SyncJOB/login');

    const login = await fetch(`${url}/SyncJOB/login`);
    expect(login.status).toBe(200);

    const health = await fetch(`${url}/SyncJOB/api/health`);
    expect(health.status).toBe(200);

    const tables = await fetch(`${url}/SyncJOB/api/tables`);
    expect(tables.status).toBe(401);
  });

  it('เข้า /SyncJOB (ไม่มี slash) ต้อง redirect ไป /SyncJOB/ โดยไม่ cache', async () => {
    const { url } = await startApp('/SyncJOB');

    const res = await fetch(`${url}/SyncJOB`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/SyncJOB/');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('หน้าเว็บใช้ URL แบบ relative และไม่มี placeholder ค้าง', async () => {
    const { url } = await startApp('/SyncJOB');

    const loginHtml = await (await fetch(`${url}/SyncJOB/login`)).text();
    expect(loginHtml).not.toContain('{{BASE}}');
    expect(loginHtml).toContain('href="login.css"');
    expect(loginHtml).toContain('src="login.js"');

    // หน้าเว็บหลักต้องโหลดได้โดยไม่ต้องล็อกอิน (ผ่าน requireAuthPage ซึ่งจะ redirect)
    const res = await fetch(`${url}/SyncJOB/`, { redirect: 'manual' });
    expect(res.status).toBe(302);
  });
});

describe('การปรับค่า APP_BASE_PATH', () => {
  it('ตัดช่องว่างและ slash ท้ายออก และเติม slash ขนาดหน้าให้ครบ', async () => {
    vi.resetModules();
    process.env.APP_BASE_PATH = 'SyncJOB/';
    const mod1 = await import('../src/server');
    expect(mod1.basePath()).toBe('/SyncJOB');

    vi.resetModules();
    process.env.APP_BASE_PATH = '/';
    const mod2 = await import('../src/server');
    expect(mod2.basePath()).toBe('');

    vi.resetModules();
    process.env.APP_BASE_PATH = '';
    const mod3 = await import('../src/server');
    expect(mod3.basePath()).toBe('');

    delete process.env.APP_BASE_PATH;
  });
});
