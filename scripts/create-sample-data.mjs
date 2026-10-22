/**
 * สร้างไฟล์ข้อมูลตัวอย่าง (data/example-customers.xlsx) สำหรับทดลองใช้งาน
 * ใช้: node scripts/create-sample-data.mjs
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'data', 'example-customers.xlsx');
fs.mkdirSync(path.dirname(out), { recursive: true });

const workbook = new ExcelJS.Workbook();
const ws = workbook.addWorksheet('ลูกค้า');

ws.getRow(1).values = ['รหัสลูกค้า', 'ชื่อลูกค้า', 'ยอดเงิน', 'สถานะ', 'วันที่สมัคร'];
ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
ws.columns = [{ width: 16 }, { width: 32 }, { width: 14 }, { width: 12 }, { width: 16 }];

ws.addRow(['C001', 'บริษัท กรุงเทพ จำกัด', 15000.5, 'active', '2024-01-31']);
ws.addRow(['C002', 'บริษัท สยาม จำกัด', 8200, 'active', '2024-02-15']);
ws.addRow(['C003', 'บริษัท เชียงใหม่ จำกัด', 3450.25, 'inactive', '2024-03-02']);
ws.addRow(['C004', 'ห้างหุ้นส่วนจำกัด เอเวอร์กรีน', 127500, 'active', '2024-03-20']);
// แถวที่ผิดพลาด: สถานะไม่อยู่ในรายการที่อนุญาต และยอดเงินไม่ใช่ตัวเลข
ws.addRow(['C005', 'บริษัท ทดสอบ จำกัด', 'ไม่ใช่ตัวเลข', 'pending', '2024-04-01']);
// แถวที่ผิดพลาด: ไม่มีรหัสลูกค้า
ws.addRow(['', 'บริษัท ไม่มีรหัส จำกัด', 100, 'active', '2024-04-10']);

for (let r = 2; r <= 20; r += 1) {
  ws.getCell(r, 3).numFmt = '#,##0.00';
  ws.getCell(r, 5).numFmt = 'yyyy-mm-dd';
}

await workbook.xlsx.writeFile(out);
console.log(`สร้างไฟล์ตัวอย่างแล้ว: ${out}`);
