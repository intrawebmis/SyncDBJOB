import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import type { ColumnMapping, TargetConfig } from '../config/schema';
import { formatDate, formatDateTime } from '../core/convert';
import { logger } from '../utils/logger';

const GUIDE_SHEET = 'คำแนะนำ';
const SAMPLE_SHEET = 'ตัวอย่างข้อมูล';

function safeSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, '-').slice(0, 31);
  return cleaned.trim() || 'Sheet1';
}

function sampleValue(col: ColumnMapping): string | number | Date {
  if (col.enum && col.enum.length > 0) return col.enum[0];
  switch (col.type) {
    case 'int':
    case 'bigint':
      return 1;
    case 'decimal':
      return 0;
    case 'float':
      return 0;
    case 'bool':
      return 1;
    case 'date':
      return formatDate(new Date());
    case 'datetime':
    case 'timestamp':
      return formatDateTime(new Date());
    case 'json':
      return '{"key":"value"}';
    default:
      return 'ตัวอย่าง';
  }
}

function numberFormatFor(col: ColumnMapping): string | undefined {
  switch (col.type) {
    case 'int':
    case 'bigint':
      return '#,##0';
    case 'decimal':
      return col.scale !== undefined ? `#,##0.${'0'.repeat(col.scale)}` : '#,##0.00';
    case 'float':
      return '#,##0.00';
    case 'date':
      return 'yyyy-mm-dd';
    case 'datetime':
    case 'timestamp':
      return 'yyyy-mm-dd hh:mm:ss';
    default:
      return undefined;
  }
}

/**
 * สร้างไฟล์ Excel ตาม mapping เพื่อใช้เป็น Template สำหรับนำเข้าข้อมูล
 */
export async function generateTemplate(target: TargetConfig, outFile: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SyncDBJOB';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(safeSheetName(target.name));
  const columns = target.columns.filter((c) => !c.skip);

  // แถวหัวตาราง
  const headerRow = sheet.getRow(target.headerRow);
  headerRow.values = columns.map((c) => c.excel || c.db);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.height = 24;

  columns.forEach((col, index) => {
    const excelCol = sheet.getColumn(index + 1);
    excelCol.width = Math.max(14, Math.min(40, (col.excel || col.db).length + 6));

    const fmt = numberFormatFor(col);
    if (fmt) {
      for (let r = target.startRow; r < target.startRow + 200; r += 1) {
        sheet.getCell(r, index + 1).numFmt = fmt;
      }
    }

    if (col.enum && col.enum.length > 0) {
      const list = `"${col.enum.join(',')}"`;
      for (let r = target.startRow; r < target.startRow + 200; r += 1) {
        sheet.getCell(r, index + 1).dataValidation = {
          type: 'list',
          allowBlank: !col.required,
          formulae: [list],
          showErrorMessage: true,
          errorTitle: 'ค่าไม่ถูกต้อง',
          error: `กรุณาเลือกจากรายการ: ${col.enum.join(', ')}`,
        };
      }
    }
  });

  sheet.views = [{ state: 'frozen', ySplit: target.headerRow }];

  // Sheet คำแนะนำ
  const guide = workbook.addWorksheet(GUIDE_SHEET);
  guide.columns = [
    { header: 'หัวตารางในไฟล์ Excel', key: 'excel', width: 28 },
    { header: 'คอลัมน์ในฐานข้อมูล', key: 'db', width: 26 },
    { header: 'ชนิดข้อมูล', key: 'type', width: 14 },
    { header: 'บังคับ', key: 'required', width: 10 },
    { header: 'ใช้เป็น Key', key: 'key', width: 12 },
    { header: 'ค่าที่อนุญาต', key: 'enum', width: 30 },
    { header: 'ความยาวสูงสุด', key: 'maxLength', width: 14 },
    { header: 'ตัวอย่าง', key: 'sample', width: 24 },
    { header: 'หมายเหตุ', key: 'note', width: 34 },
  ];
  guide.getRow(1).font = { bold: true };
  for (const col of columns) {
    guide.addRow({
      excel: col.excel || col.db,
      db: col.db,
      type: col.type,
      required: col.required ? 'ใช่' : 'ไม่',
      key: target.keys.includes(col.db) || col.isKey ? 'ใช่' : 'ไม่',
      enum: col.enum ? col.enum.join(', ') : '',
      maxLength: col.maxLength ?? '',
      sample: String(sampleValue(col)),
      note: buildNote(col),
    });
  }
  guide.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

  // Sheet ตัวอย่างข้อมูล
  const sample = workbook.addWorksheet(SAMPLE_SHEET);
  sample.getRow(1).values = columns.map((c) => c.excel || c.db);
  sample.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sample.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF548235' } };
  for (let i = 0; i < 3; i += 1) {
    sample.addRow(columns.map((c) => sampleValue(c)));
  }

  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  await workbook.xlsx.writeFile(outFile);
  logger.info('สร้างไฟล์ template สำเร็จ', { file: outFile, table: target.table, columns: columns.length });
}

function buildNote(col: ColumnMapping): string {
  const notes: string[] = [];
  if (col.required) notes.push('ต้องกรอก');
  if (col.maxLength) notes.push(`ยาวไม่เกิน ${col.maxLength} ตัวอักษร`);
  if (col.min !== undefined) notes.push(`ค่าต่ำสุด ${col.min}`);
  if (col.max !== undefined) notes.push(`ค่าสูงสุด ${col.max}`);
  if (col.pattern) notes.push(`รูปแบบ: ${col.pattern}`);
  if (col.constant !== undefined) notes.push(`ค่าคงที่: ${String(col.constant)}`);
  if (col.isKey) notes.push('ใช้เป็นคีย์ของข้อมูล');
  return notes.join(' | ');
}
