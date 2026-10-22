import ExcelJS from 'exceljs';
import { logger } from '../utils/logger';
import { normalizeCell } from '../core/convert';

export interface SheetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface RawRow {
  /** เลขแถวจริงในไฟล์ Excel (1-based) */
  rowNumber: number;
  cells: Array<string | number | Date | null>;
}

export interface SheetData {
  sheet: string;
  headers: string[];
  /** ข้อมูลตั้งแต่แถว startRow เป็นต้นไป */
  rows: RawRow[];
  totalRows: number;
}

const EXCELJS_MAX_ROWS = 1_048_576;
const EXCELJS_MAX_COLS = 16_384;

export class ExcelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExcelError';
  }
}

function assertXlsx(filePath: string): void {
  const ext = filePath.toLowerCase().split('.').pop();
  if (ext !== 'xlsx' && ext !== 'xlsm') {
    throw new ExcelError(
      `รองรับเฉพาะไฟล์ .xlsx / .xlsm (ได้รับ .${ext ?? 'ไม่ทราบ'}) — กรุณาบันทึกไฟล์ .xls เป็น .xlsx ก่อน`,
    );
  }
}

async function loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  assertXlsx(filePath);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (err) {
    throw new ExcelError(`ไม่สามารถเปิดไฟล์ Excel ได้: ${(err as Error).message}`);
  }
  return workbook;
}

/** เติมค่าจากเซลล์ที่ merge ไว้ ลงทุกเซลล์ในช่วง merge (ป้องกันค่าว่างหาย) */
function fillMergedCells(worksheet: ExcelJS.Worksheet): void {
  const merges = (worksheet as unknown as { model?: { merges?: string[] } }).model?.merges ?? [];
  for (const merge of merges) {
    const [start, end] = merge.split(':');
    const s = worksheet.getCell(start);
    const e = worksheet.getCell(end);
    const value = normalizeCell(s.value);
    if (value === null) continue;
    const sRow = s.row;
    const sCol = s.col;
    const eRow = e.row;
    const eCol = e.col;
    for (let r = sRow; r <= eRow; r += 1) {
      for (let c = sCol; c <= eCol; c += 1) {
        const cell = worksheet.getCell(r, c);
        if (normalizeCell(cell.value) === null) {
          cell.value = value instanceof Date ? new Date(value.getTime()) : value;
        }
      }
    }
  }
}

function worksheetRowCount(worksheet: ExcelJS.Worksheet): number {
  let count = 0;
  worksheet.eachRow({ includeEmpty: false }, () => {
    count += 1;
  });
  return count;
}

export async function listSheets(filePath: string): Promise<SheetInfo[]> {
  const workbook = await loadWorkbook(filePath);
  return workbook.worksheets.map((ws) => ({
    name: ws.name,
    rowCount: worksheetRowCount(ws),
    columnCount: ws.columnCount,
  }));
}

export async function getSheetNames(filePath: string): Promise<string[]> {
  const workbook = await loadWorkbook(filePath);
  return workbook.worksheets.map((ws) => ws.name);
}

function readRows(worksheet: ExcelJS.Worksheet, startRow: number, endRow: number): RawRow[] {
  const rows: RawRow[] = [];
  const maxRow = Math.min(worksheet.rowCount, endRow, EXCELJS_MAX_ROWS);
  for (let r = startRow; r <= maxRow; r += 1) {
    const row = worksheet.getRow(r);
    const cells: Array<string | number | Date | null> = [];
    const colCount = Math.min(row.cellCount, EXCELJS_MAX_COLS);
    for (let c = 1; c <= colCount; c += 1) {
      cells.push(normalizeCell(row.getCell(c).value));
    }
    rows.push({ rowNumber: r, cells });
  }
  return rows;
}

function isRowEmpty(cells: Array<string | number | Date | null>): boolean {
  return cells.every((c) => c === null || (typeof c === 'string' && c.trim() === ''));
}

/** อ่าน sheet ตามการตั้งค่า header/start row */
export async function readSheet(
  filePath: string,
  options: { sheet?: string; headerRow?: number; startRow?: number; maxRows?: number } = {},
): Promise<SheetData> {
  const headerRow = options.headerRow ?? 1;
  const startRow = options.startRow ?? headerRow + 1;

  const workbook = await loadWorkbook(filePath);
  let worksheet: ExcelJS.Worksheet | undefined;
  if (options.sheet) {
    worksheet = workbook.getWorksheet(options.sheet);
    if (!worksheet) {
      const available = workbook.worksheets.map((w) => w.name).join(', ');
      throw new ExcelError(`ไม่พบ sheet "${options.sheet}" (ที่มี: ${available})`);
    }
  } else {
    worksheet = workbook.worksheets[0];
  }
  if (!worksheet) throw new ExcelError('ไฟล์ Excel ไม่มี sheet เลย');

  fillMergedCells(worksheet);

  const headerCells = readRows(worksheet, headerRow, headerRow)[0]?.cells ?? [];
  const headers = headerCells.map((cell, index) => {
    const text = cell === null ? '' : String(cell).trim();
    return text === '' ? `คอลัมน์_${index + 1}` : text;
  });

  const endRow = options.maxRows ? Math.min(worksheet.rowCount, startRow + options.maxRows - 1) : worksheet.rowCount;
  const raw = readRows(worksheet, startRow, endRow);
  const rows = raw.filter((r) => !isRowEmpty(r.cells));

  return {
    sheet: worksheet.name,
    headers,
    rows,
    totalRows: rows.length,
  };
}

/** เดาว่าแถวไหนคือหัวตาราง (แถวที่มีข้อความเยอะที่สุดในช่วงแรก) */
export async function detectHeaderRow(filePath: string, sheet?: string): Promise<number> {
  const workbook = await loadWorkbook(filePath);
  const worksheet = sheet ? workbook.getWorksheet(sheet) : workbook.worksheets[0];
  if (!worksheet) return 1;
  fillMergedCells(worksheet);

  let bestRow = 1;
  let bestScore = -1;
  const limit = Math.min(worksheet.rowCount, 20);
  for (let r = 1; r <= limit; r += 1) {
    const row = worksheet.getRow(r);
    let score = 0;
    let textCells = 0;
    for (let c = 1; c <= Math.min(row.cellCount, 50); c += 1) {
      const value = normalizeCell(row.getCell(c).value);
      if (value === null) continue;
      if (typeof value === 'string' && value.trim() !== '') {
        score += 1;
        textCells += 1;
      } else if (typeof value === 'number') {
        score += 0.4;
      }
    }
    // แถวหัวตารางมักมีข้อความล้วน
    const weighted = score + (textCells >= 2 ? 1 : 0);
    if (weighted > bestScore) {
      bestScore = weighted;
      bestRow = r;
    }
  }
  logger.debug('detectHeaderRow', { file: filePath, sheet: worksheet.name, headerRow: bestRow });
  return bestRow;
}
