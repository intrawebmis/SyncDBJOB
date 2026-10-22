import type { ColumnMapping, TargetConfig } from '../config/schema';
import { coerceValue, isBlank, normalizeCell } from './convert';
import type { RowIssue, ValidatedRow } from './types';

export interface ValidationResult {
  rows: ValidatedRow[];
  issues: RowIssue[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
}

/** หาคอลัมน์ใน Excel จากชื่อหัวตาราง (เทียบแบบไม่สนตัวพิมพ์และช่องว่าง) */
export function matchHeader(headers: string[], header: string): number {
  const wanted = header.trim().toLowerCase();
  if (!wanted) return -1;
  let exact = -1;
  let loose = -1;
  for (let i = 0; i < headers.length; i += 1) {
    const actual = headers[i].trim().toLowerCase();
    if (actual === wanted) {
      exact = i;
      break;
    }
    if (loose === -1 && (actual.replace(/[\s_-]/g, '') === wanted.replace(/[\s_-]/g, ''))) {
      loose = i;
    }
  }
  return exact !== -1 ? exact : loose;
}

/**
 * ตรวจสอบและแปลงข้อมูลทุกแถวตาม mapping
 * คืนค่าทั้งค่าที่พร้อมเขียนลง DB และรายการปัญหา
 */
export function validateRows(
  headers: string[],
  rawRows: Array<{ rowNumber: number; cells: Array<string | number | Date | null> }>,
  target: TargetConfig,
): ValidationResult {
  const issues: RowIssue[] = [];
  const rows: ValidatedRow[] = [];

  // จับคู่หัวตารางกับ mapping ล่วงหน้า
  const columnIndex = new Map<string, number>();
  for (const col of target.columns) {
    if (col.skip) continue;
    const idx = matchHeader(headers, col.excel);
    if (idx >= 0) columnIndex.set(col.db, idx);
  }

  for (const raw of rawRows) {
    const values: Record<string, unknown> = {};
    const rowIssues: RowIssue[] = [];

    for (const col of target.columns) {
      if (col.skip) continue;

      if (col.constant !== undefined && col.constant !== null) {
        values[col.db] = col.constant;
        continue;
      }

      const idx = columnIndex.get(col.db);
      if (idx === undefined) {
        if (col.required) {
          rowIssues.push({
            row: raw.rowNumber,
            column: col.excel || col.db,
            message: `ไม่พบหัวตาราง "${col.excel}" ในไฟล์ Excel`,
          });
          values[col.db] = null;
        } else {
          values[col.db] = null;
        }
        continue;
      }

      const cellValue = raw.cells[idx] ?? null;
      if (isBlank(cellValue) && col.default !== undefined && col.default !== null) {
        values[col.db] = col.default;
        continue;
      }

      const result = coerceValue(cellValue, col);
      if (result.ok) {
        values[col.db] = result.value;
      } else {
        values[col.db] = null;
        rowIssues.push({
          row: raw.rowNumber,
          column: col.excel || col.db,
          message: result.message,
          value: isBlank(cellValue) ? undefined : normalizeCell(cellValue),
        });
      }
    }

    // ตรวจ key ของ upsert ต้องมีค่า
    for (const key of target.keys) {
      const value = values[key];
      if (value === null || value === undefined || value === '') {
        rowIssues.push({
          row: raw.rowNumber,
          column: key,
          message: `คอลัมน์ key "${key}" ต้องมีค่า`,
        });
      }
    }

    rows.push({ rowNumber: raw.rowNumber, values, issues: rowIssues });
    issues.push(...rowIssues);
  }

  const invalidRows = rows.filter((r) => r.issues.length > 0).length;
  return {
    rows,
    issues,
    totalRows: rows.length,
    validRows: rows.length - invalidRows,
    invalidRows,
  };
}

/** คำสัมพันธ์ไทย-อังกฤษ ช่วยให้จับคู่หัวตารางภาษาไทยกับชื่อคอลัมน์ภาษาอังกฤษได้ */
const SYNONYMS: Record<string, string[]> = {
  รหัส: ['code', 'id', 'no', 'number', 'ref', 'key', 'sku'],
  ชื่อ: ['name', 'firstname', 'lastname', 'fullname', 'title', 'nickname'],
  ยอดเงิน: ['amount', 'balance', 'total', 'sum', 'value', 'money', 'price'],
  วันที่: ['date', 'day', 'registered', 'created', 'birth'],
  เวลา: ['time', 'timestamp', 'datetime', 'hour'],
  สถานะ: ['status', 'state', 'flag', 'active'],
  จำนวน: ['qty', 'quantity', 'count', 'amount'],
  ราคา: ['price', 'cost', 'rate'],
  ลูกค้า: ['customer', 'client', 'buyer', 'member'],
  สินค้า: ['product', 'item', 'goods', 'sku'],
  ที่อยู่: ['address', 'addr', 'location'],
  โทรศัพท์: ['phone', 'mobile', 'tel'],
  อีเมล: ['email', 'mail'],
  หมายเหตุ: ['remark', 'note', 'comment', 'description'],
  ผู้ใช้: ['user', 'username', 'account'],
  เพศ: ['gender', 'sex'],
  วันเกิด: ['birth', 'birthday', 'dob'],
  แผนก: ['department', 'dept', 'division'],
  ประเทศ: ['country'],
  จังหวัด: ['province'],
  เมือง: ['city'],
  รหัสไปรษณีย์: ['zip', 'postcode', 'postal'],
  ผู้สร้าง: ['created', 'creator', 'createdby'],
  ผู้แก้ไข: ['updated', 'editor', 'updatedby'],
  กลุ่ม: ['group', 'category', 'type'],
};

/**
 * ให้คะแนนความเป็นไปได้ของการจับคู่หัวตาราง (ไทย) กับชื่อคอลัมน์ (อังกฤษ)
 * - ตรงกันเป๊ะ            : 1000
 * - หนึ่งเป็นส่วนหนึ่งของอีกอัน : 500
 * - ผ่านคำสัมพันธ์          : จำนวนคำที่อธิบายได้ x 1000 + คะแนนความยาว
 */
function scoreMatch(header: string, dbName: string): number {
  const headerKey = header.trim().toLowerCase().replace(/[\s_-]/g, '');
  const dbKey = dbName.toLowerCase().replace(/[\s_-]/g, '');
  if (!headerKey || !dbKey) return 0;

  if (headerKey === dbKey) return 1000;
  if (headerKey.includes(dbKey) || dbKey.includes(headerKey)) return 500 + Math.min(headerKey.length, dbKey.length);

  const words = header.toLowerCase().split(/[\s_/]+/).filter(Boolean);
  let coverage = 0;
  let bonus = 0;
  const covered = new Set<string>();

  for (const word of words) {
    for (const [key, synonyms] of Object.entries(SYNONYMS)) {
      if (!word.includes(key) || covered.has(key)) continue;
      let best = 0;
      for (const syn of synonyms) {
        const sk = syn.replace(/[\s_-]/g, '');
        if (dbKey === sk) best = Math.max(best, 100 + sk.length);
        else if (dbKey.includes(sk)) best = Math.max(best, 10 + sk.length);
      }
      if (best > 0) {
        coverage += 1;
        bonus += best;
        covered.add(key);
      }
    }
  }

  return coverage > 0 ? coverage * 1000 + bonus : 0;
}

/** สร้าง mapping อัตโนมัติโดยเทียบชื่อหัวตารางกับชื่อคอลัมน์ใน DB */
export function autoMapColumns(
  headers: string[],
  dbColumns: Array<{ name: string; dataType: string }>,
): Array<{ excel: string; db: string; matched: boolean }> {
  return headers.map((header) => {
    let bestName = '';
    let bestScore = 0;
    for (const col of dbColumns) {
      const score = scoreMatch(header, col.name);
      if (score > bestScore) {
        bestScore = score;
        bestName = col.name;
      }
    }
    return { excel: header, db: bestName, matched: bestScore > 0 };
  });
}

/** เดาชนิดข้อมูลจากชนิดข้อมูลใน MySQL */
export function guessType(mysqlType: string): ColumnMapping['type'] {
  const t = mysqlType.toLowerCase();
  if (t === 'tinyint(1)') return 'bool';
  if (t.includes('bool')) return 'bool';
  if (t.includes('bigint')) return 'bigint';
  if (t.includes('int') || t.includes('bit')) return 'int';
  if (t.includes('decimal') || t.includes('numeric')) return 'decimal';
  if (t.includes('float') || t.includes('double') || t.includes('real')) return 'float';
  if (t.includes('timestamp') || t.includes('datetime')) return 'datetime';
  if (t.includes('date')) return 'date';
  if (t.includes('json')) return 'json';
  return 'string';
}
