/**
 * ทดสอบ API ของ Web UI แบบอัตโนมัติ (ไม่ต้องใช้ฐานข้อมูลจริง)
 * ใช้: node scripts/smoke-test.mjs [baseUrl]
 * ตัวอย่าง: node scripts/smoke-test.mjs http://127.0.0.1:3000
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.argv[2] || 'http://127.0.0.1:3000';
const sample = path.join(root, 'data', 'example-customers.xlsx');

let pass = 0;
let fail = 0;

function check(name, condition, extra = '') {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function json(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: { raw: text } };
  }
}

console.log(`ทดสอบ Web UI ที่ ${baseUrl}\n`);

// 1. หน้าเว็บ
console.log('1) หน้าเว็บและไฟล์ static');
const home = await fetch(baseUrl + '/');
check('หน้าเว็บตอบกลับ 200', home.status === 200);
const html = await home.text();
check('มีชื่อระบบ SyncDBJOB', html.includes('SyncDB'));
const js = await fetch(baseUrl + '/app.js');
check('โหลด app.js ได้', js.status === 200);
const css = await fetch(baseUrl + '/styles.css');
check('โหลด styles.css ได้', css.status === 200);

// 2. สถานะการเชื่อมต่อ
console.log('\n2) สถานะการเชื่อมต่อ MySQL');
const health = await json(baseUrl + '/api/health');
check('ตอบกลับสถานะการเชื่อมต่อ', health.data.ok === true, JSON.stringify(health.data));
console.log(`   connected=${health.data.connected} database=${health.data.database}`);

// 3. อัปโหลดไฟล์
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

// 4. ดูตัวอย่างข้อมูล
console.log('\n4) ดูตัวอย่างข้อมูล');
const preview = await json(baseUrl + '/api/preview', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fileId, sheet: 'ลูกค้า', headerRow: 1, limit: 5 }),
});
check('อ่านหัวตารางได้', preview.data.headers?.length === 5, JSON.stringify(preview.data.headers));
check('อ่านข้อมูลได้', preview.data.rows?.length === 5, String(preview.data.rows?.length));

// 5. จับคู่คอลัมน์อัตโนมัติ
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

// 6. สร้าง mapping และตรวจสอบข้อมูล
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

// 7. บันทึกและดูรายการ mapping
console.log('\n7) บันทึกการตั้งค่า');
const saved = await json(baseUrl + '/api/mappings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'ทดสอบ', config }),
});
check('บันทึก mapping สำเร็จ', saved.data.ok === true && Boolean(saved.data.mapping?.id));
const list = await json(baseUrl + '/api/mappings');
check('แสดงรายการ mapping ได้', list.data.mappings?.length >= 1);

// 8. สร้าง DDL (ยังไม่ apply)
console.log('\n8) สร้าง DDL');
const ddl = await json(baseUrl + '/api/ddl', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ config }),
});
check('สร้างคำสั่ง CREATE TABLE ได้', ddl.data.sql?.includes('CREATE TABLE IF NOT EXISTS `customers`'));

// 9. สร้างไฟล์ template
console.log('\n9) สร้างไฟล์ template');
const tpl = await json(baseUrl + '/api/template', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ config, outFile: 'storage/smoke-template.xlsx' }),
});
check('สร้างไฟล์ template ได้', tpl.data.ok === true && fs.existsSync(tpl.data.file ?? ''));

// 10. ลบ mapping ที่สร้างระหว่างทดสอบ
if (saved.data.mapping?.id) {
  await fetch(`${baseUrl}/api/mappings/${saved.data.mapping.id}`, { method: 'DELETE' });
}

console.log(`\nผลการทดสอบ: ผ่าน ${pass} ไม่ผ่าน ${fail}`);
process.exit(fail > 0 ? 1 : 0);
