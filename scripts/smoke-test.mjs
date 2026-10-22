/**
 * ทดสอบ API ของ Web UI แบบอัตโนมัติ (ไม่ต้องใช้ฐานข้อมูลจริง)
 * ใช้: node scripts/smoke-test.mjs [baseUrl]
 * ตัวอย่าง: node scripts/smoke-test.mjs http://127.0.0.1:3000
 *
 * ถ้าเซิร์ฟเวอร์เปิดระบบล็อกอิน (APP_AUTH_ENABLED=true) ต้องส่งข้อมูลเข้าสู่ระบบ:
 *   set SMOKE_USERNAME=admin
 *   set SMOKE_PASSWORD=xxxx
 * หรือปิดระบบล็อกอินชั่วคราวด้วย APP_AUTH_ENABLED=false
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.argv[2] || 'http://127.0.0.1:3000';
const sample = path.join(root, 'data', 'example-customers.xlsx');
const username = process.env.SMOKE_USERNAME || '';
const password = process.env.SMOKE_PASSWORD || '';

let pass = 0;
let fail = 0;

/** cookie ที่ได้หลังล็อกอิน */
let cookie = '';

function check(name, condition, extra = '') {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

function withCookie(options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  return { ...options, headers, redirect: 'manual' };
}

async function json(url, options) {
  const res = await fetch(url, withCookie(options));
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text), headers: res.headers };
  } catch {
    return { status: res.status, data: { raw: text }, headers: res.headers };
  }
}

console.log(`ทดสอบ Web UI ที่ ${baseUrl}\n`);

// ============================================================ 0) ระบบล็อกอิน
console.log('0) ระบบล็อกอิน');
const healthBefore = await json(baseUrl + '/api/health');
const authEnabled = healthBefore.data.authEnabled !== false;

if (authEnabled) {
  // ยังไม่ล็อกอิน → ต้องโดนปฏิเสธ
  const protectedRes = await json(baseUrl + '/api/tables');
  check('API ที่ต้องล็อกอินตอบ 401', protectedRes.status === 401, `status=${protectedRes.status}`);

  const loginPage = await fetch(baseUrl + '/login', { redirect: 'manual' });
  check('หน้า /login เข้าถึงได้โดยไม่ต้องล็อกอิน', loginPage.status === 200);
  const loginHtml = await loginPage.text();
  check('หน้า /login มีฟอร์มเข้าสู่ระบบ', loginHtml.includes('loginForm'));

  const loginCss = await fetch(baseUrl + '/login.css');
  check('โหลด login.css ได้', loginCss.status === 200);

  const homeNoAuth = await fetch(baseUrl + '/', { redirect: 'manual' });
  check(
    'หน้าเว็บถูกพาไปหน้า /login เมื่อยังไม่ล็อกอิน',
    homeNoAuth.status === 302 && String(homeNoAuth.headers.get('location')).includes('/login'),
    `status=${homeNoAuth.status} loc=${homeNoAuth.headers.get('location')}`,
  );

  if (!username || !password) {
    console.log('   ! ยังไม่ได้ใส่ SMOKE_USERNAME / SMOKE_PASSWORD — ทดสอบส่วนที่ต้องล็อกอินไม่ได้');
    console.log(`\nผลการทดสอบ: ผ่าน ${pass} ไม่ผ่าน ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }

  const badLogin = await json(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'wrong-password-' + Date.now() }),
  });
  check('ล็อกอินด้วยรหัสผ่านผิดไม่ได้', badLogin.status === 401, `status=${badLogin.status}`);

  const login = await json(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  check('ล็อกอินสำเร็จ', login.status === 200 && login.data.ok === true, JSON.stringify(login.data));
  check('ได้รับข้อมูลผู้ใช้กลับมา', Boolean(login.data.user?.username), JSON.stringify(login.data.user));

  const setCookie = login.headers.get('set-cookie') || '';
  check('ได้รับ cookie session', setCookie.includes('sdj_session='), setCookie);
  check('cookie เป็น HttpOnly', setCookie.includes('HttpOnly'));
  cookie = setCookie.split(';')[0];

  const me = await json(baseUrl + '/api/auth/me');
  check('ตรวจสอบผู้ใช้ที่ล็อกอินได้', me.status === 200 && me.data.user?.username === username);
} else {
  console.log('   · ระบบล็อกอินปิดอยู่ (APP_AUTH_ENABLED=false) — ข้ามการทดสอบส่วนนี้');
}

// ============================================================ 1) หน้าเว็บ
console.log('\n1) หน้าเว็บและไฟล์ static');
const home = await fetch(baseUrl + '/', withCookie());
check('หน้าเว็บตอบกลับ 200', home.status === 200);
const html = await home.text();
check('มีชื่อระบบ SyncDBJOB', html.includes('SyncDB'));
check('มีปุ่มออกจากระบบ', html.includes('btnLogout'));
const js = await fetch(baseUrl + '/app.js', withCookie());
check('โหลด app.js ได้', js.status === 200);
const css = await fetch(baseUrl + '/styles.css', withCookie());
check('โหลด styles.css ได้', css.status === 200);

// ============================================================ 2) สถานะการเชื่อมต่อ
console.log('\n2) สถานะการเชื่อมต่อ MySQL');
const health = await json(baseUrl + '/api/health');
check('ตอบกลับสถานะการเชื่อมต่อ', health.data.ok === true, JSON.stringify(health.data));
console.log(`   connected=${health.data.connected} database=${health.data.database ?? '(ซ่อนไว้)'}`);

// ============================================================ 3) อัปโหลดไฟล์
console.log('\n3) อัปโหลดไฟล์ Excel');
if (!fs.existsSync(sample)) {
  console.log('   ! ไม่พบไฟล์ตัวอย่าง — รัน node scripts/create-sample-data.mjs ก่อน');
  process.exit(1);
}
const form = new FormData();
form.append('file', new Blob([fs.readFileSync(sample)]), 'example-customers.xlsx');
const upload = await json(baseUrl + '/api/upload', { method: 'POST', body: form });
check('อัปโหลดสำเร็จ', upload.data.ok === true, JSON.stringify(upload.data));
check('ตรวจจับชื่อ sheet ภาษาไทยได้', upload.data.sheets?.[0]?.name === 'ลูกค้า', JSON.stringify(upload.data.sheets));
const fileId = upload.data.fileId;

// ============================================================ 4) ดูตัวอย่างข้อมูล
console.log('\n4) ดูตัวอย่างข้อมูล');
const preview = await json(baseUrl + '/api/preview', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fileId, sheet: 'ลูกค้า', headerRow: 1, limit: 5 }),
});
check('อ่านหัวตารางได้', preview.data.headers?.length === 5, JSON.stringify(preview.data.headers));
check('อ่านข้อมูลได้', preview.data.rows?.length === 5, String(preview.data.rows?.length));

// ============================================================ 5) จับคู่คอลัมน์อัตโนมัติ
console.log('\n5) จับคู่คอลัมน์อัตโนมัติ');
const autoMap = await json(baseUrl + '/api/auto-map', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    headers: preview.data.headers,
    columns: [
      { name: 'customer_code', dataType: 'varchar' },
      { name: 'customer_name', dataType: 'varchar' },
      { name: 'balance', dataType: 'decimal' },
      { name: 'status', dataType: 'varchar' },
      { name: 'registered_at', dataType: 'date' },
    ],
  }),
});
const matched = autoMap.data.suggestions?.filter((s) => s.matched).length ?? 0;
check('จับคู่หัวตารางไทยกับคอลัมน์อังกฤษได้', matched >= 4, `matched=${matched}`);

// ============================================================ 6) สร้าง mapping และตรวจสอบข้อมูล
console.log('\n6) ตรวจสอบข้อมูลด้วย mapping');
const config = {
  version: 1,
  name: 'ทดสอบ',
  targets: [
    {
      name: 'customers',
      table: 'customers',
      mode: 'upsert',
      keys: ['customer_code'],
      sheet: 'ลูกค้า',
      headerRow: 1,
      startRow: 2,
      columns: [
        { excel: 'รหัสลูกค้า', db: 'customer_code', type: 'string', required: true, isKey: true },
        { excel: 'ชื่อลูกค้า', db: 'customer_name', type: 'string', required: true },
        { excel: 'ยอดเงิน', db: 'balance', type: 'decimal', scale: 2 },
        { excel: 'สถานะ', db: 'status', type: 'string', enum: ['active', 'inactive'] },
        { excel: 'วันที่สมัคร', db: 'registered_at', type: 'date' },
      ],
    },
  ],
};

const validate = await json(baseUrl + '/api/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fileId, config }),
});
check('ตรวจสอบข้อมูลได้', validate.data.ok === true, JSON.stringify(validate.data));
check('พบแถวผิดพลาดตามที่คาดไว้', validate.data.invalidRows === 2, `invalid=${validate.data.invalidRows}`);
check('ระบุเลขแถวที่ผิดพลาด', validate.data.issues?.[0]?.row >= 6, JSON.stringify(validate.data.issues));

// ============================================================ 7) บันทึกและดูรายการ mapping
console.log('\n7) บันทึกการตั้งค่า');
const saved = await json(baseUrl + '/api/mappings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'ทดสอบ', config }),
});
check('บันทึก mapping สำเร็จ', saved.data.ok === true && Boolean(saved.data.mapping?.id));
const list = await json(baseUrl + '/api/mappings');
check('แสดงรายการ mapping ได้', list.data.mappings?.length >= 1);

// ============================================================ 8) สร้าง DDL (ยังไม่ apply)
console.log('\n8) สร้าง DDL');
const ddl = await json(baseUrl + '/api/ddl', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ config }),
});
check('สร้างคำสั่ง CREATE TABLE ได้', ddl.data.sql?.includes('CREATE TABLE IF NOT EXISTS `customers`'));

// ============================================================ 9) สร้างไฟล์ template
console.log('\n9) สร้างไฟล์ template');
const tpl = await json(baseUrl + '/api/template', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ config, outFile: 'storage/smoke-template.xlsx' }),
});
check('สร้างไฟล์ template ได้', tpl.data.ok === true && fs.existsSync(tpl.data.file ?? ''));

// ============================================================ 10) ลบ mapping ที่สร้างระหว่างทดสอบ
if (saved.data.mapping?.id) {
  await fetch(`${baseUrl}/api/mappings/${saved.data.mapping.id}`, {
    method: 'DELETE',
    headers: cookie ? { Cookie: cookie } : {},
  });
}

// ============================================================ 11) ล็อกเอาต์
if (authEnabled) {
  console.log('\n11) ล็อกเอาต์');
  const logout = await json(baseUrl + '/api/auth/logout', { method: 'POST' });
  check('ล็อกเอาต์สำเร็จ', logout.data.ok === true);
  const after = await json(baseUrl + '/api/tables');
  check('หลังล็อกเอาต์ API กลับมาเป็น 401', after.status === 401, `status=${after.status}`);
}

console.log(`\nผลการทดสอบ: ผ่าน ${pass} ไม่ผ่าน ${fail}`);
process.exit(fail > 0 ? 1 : 0);
