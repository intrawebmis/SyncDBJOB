import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateTemplate } from '../src/excel/template';
import { detectHeaderRow, listSheets, readSheet } from '../src/excel/reader';
import { loadMappingFile } from '../src/config/load';
import type { TargetConfig } from '../src/config/schema';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syncdb-excel-'));

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function target(): TargetConfig {
  return {
    name: 'customers',
    table: 'customers',
    mode: 'upsert',
    keys: ['code'],
    sheet: 'customers',
    headerRow: 1,
    startRow: 2,
    skipEmptyRows: true,
    columns: [
      { excel: 'รหัสลูกค้า', db: 'code', type: 'string', required: true, isKey: true, maxLength: 20, trim: true, skip: false },
      { excel: 'ชื่อลูกค้า', db: 'name', type: 'string', required: false, isKey: false, trim: true, skip: false },
      { excel: 'ยอดเงิน', db: 'balance', type: 'decimal', required: false, isKey: false, scale: 2, trim: true, skip: false },
      { excel: 'สถานะ', db: 'status', type: 'string', required: false, isKey: false, enum: ['active', 'inactive'], trim: true, skip: false },
    ],
  } as TargetConfig;
}

describe('generateTemplate', () => {
  it('สร้างไฟล์ Excel ที่มีหัวตารางและ sheet คำแนะนำ', async () => {
    const out = path.join(tmp, 'template.xlsx');
    await generateTemplate(target(), out);

    expect(fs.existsSync(out)).toBe(true);

    const sheets = await listSheets(out);
    expect(sheets.map((s) => s.name)).toContain('customers');
    expect(sheets.map((s) => s.name)).toContain('คำแนะนำ');

    const data = await readSheet(out, { sheet: 'customers', headerRow: 1, startRow: 2 });
    expect(data.headers).toEqual(['รหัสลูกค้า', 'ชื่อลูกค้า', 'ยอดเงิน', 'สถานะ']);
  });

  it('detectHeaderRow หาแถวหัวตารางได้ถูกต้อง', async () => {
    const out = path.join(tmp, 'template2.xlsx');
    await generateTemplate(target(), out);
    const row = await detectHeaderRow(out, 'customers');
    expect(row).toBe(1);
  });
});

describe('readSheet', () => {
  it('ข้ามแถวที่ว่างทั้งหมด', async () => {
    const out = path.join(tmp, 'withblank.xlsx');
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('data');
    ws.addRow(['a', 'b']);
    ws.addRow(['1', '2']);
    ws.addRow(['', '']);
    ws.addRow(['3', '4']);
    await wb.xlsx.writeFile(out);

    const data = await readSheet(out, { headerRow: 1, startRow: 2 });
    expect(data.totalRows).toBe(2);
    expect(data.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
  });

  it('แจ้งข้อผิดพลาดเมื่อไม่พบ sheet', async () => {
    const out = path.join(tmp, 'withblank.xlsx');
    await expect(readSheet(out, { sheet: 'ไม่มี' })).rejects.toThrow(/ไม่พบ sheet/);
  });
});

describe('loadMappingFile', () => {
  it('อ่านไฟล์ YAML และตรวจความถูกต้อง', async () => {
    const file = path.join(tmp, 'mapping.yaml');
    fs.writeFileSync(
      file,
      `version: 1
name: ลูกค้า
targets:
  - name: customers
    table: customers
    mode: upsert
    keys: [code]
    headerRow: 1
    startRow: 2
    columns:
      - excel: รหัสลูกค้า
        db: code
        type: string
        required: true
        isKey: true
`,
      'utf8',
    );

    const config = await loadMappingFile(file);
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0].table).toBe('customers');
    expect(config.targets[0].columns[0].db).toBe('code');
  });

  it('แจ้งข้อผิดพลาดเมื่อ upsert ไม่มี key', async () => {
    const file = path.join(tmp, 'bad.yaml');
    fs.writeFileSync(
      file,
      `targets:
  - name: t
    table: t
    mode: upsert
    columns:
      - db: a
        type: string
`,
      'utf8',
    );

    await expect(loadMappingFile(file)).rejects.toThrow(/keys/);
  });
});
