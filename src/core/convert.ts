import type { ColumnMapping, ColumnType } from '../config/schema';

export interface CoerceOk {
  ok: true;
  value: unknown;
}
export interface CoerceFail {
  ok: false;
  message: string;
}
export type CoerceResult = CoerceOk | CoerceFail;

const TRUE_WORDS = new Set(['true', '1', 'yes', 'y', 't', 'ใช่', 'จริง', 'yes', 'เปิด', 'active']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'n', 'f', 'ไม่ใช่', 'เท็จ', 'ปิด', 'inactive']);

/** แปลงค่าจากเซลล์ Excel เป็นข้อความ/ตัวเลข/วันที่พื้นฐาน */
export function normalizeCell(value: unknown): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>).map((part) => part.text ?? '').join('');
    }
    if (obj.formula !== undefined || obj.sharedFormula !== undefined) {
      return normalizeCell(obj.result);
    }
    if (obj.hyperlink !== undefined && obj.text !== undefined) {
      return normalizeCell(obj.text);
    }
    if (obj.error !== undefined) return null;
    if (obj.text !== undefined) return normalizeCell(obj.text);
    if (obj.result !== undefined) return normalizeCell(obj.result);
  }

  return String(value);
}

export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

/** Excel serial -> Date (ระบบปฏิทิน 1900) */
export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  // แก้บั๊ก leap year ปี 1900 ของ Excel
  const adjusted = serial > 59 ? serial : serial + 1;
  const ms = Math.round((adjusted - 25569) * 86_400_000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** แปลงวันที่จากรูปแบบต่าง ๆ ให้เป็น Date */
export function parseDateInput(input: string): Date | null {
  const text = input.trim();
  if (!text) return null;

  // ISO: 2024-01-31 หรือ 2024-01-31T10:00:00
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (m) {
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      m[4] ? Number(m[4]) : 0,
      m[5] ? Number(m[5]) : 0,
      m[6] ? Number(m[6]) : 0,
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // DD/MM/YYYY หรือ DD-MM-YYYY
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (m) {
    const d = new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      m[4] ? Number(m[4]) : 0,
      m[5] ? Number(m[5]) : 0,
      m[6] ? Number(m[6]) : 0,
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function cleanNumberText(text: string): string {
  return text.replace(/,/g, '').replace(/\s/g, '');
}

/**
 * แปลงค่าเซลล์ให้ตรงกับชนิดข้อมูลในฐานข้อมูล พร้อมตรวจสอบเงื่อนไขต่าง ๆ
 */
export function coerceValue(raw: unknown, col: ColumnMapping): CoerceResult {
  const type = col.type as ColumnType;
  const normalized = normalizeCell(raw);

  if (isBlank(normalized)) {
    if (col.required) {
      return { ok: false, message: `ค่าว่าง (${col.db} เป็นคอลัมน์บังคับ)` };
    }
    return { ok: true, value: null };
  }

  switch (type) {
    case 'string': {
      let text = String(normalized);
      if (col.trim) text = text.trim();
      if (col.maxLength && text.length > col.maxLength) {
        return { ok: false, message: `ความยาวเกิน ${col.maxLength} ตัวอักษร (${text.length})` };
      }
      if (col.enum && !col.enum.some((e) => e.toLowerCase() === text.toLowerCase())) {
        return { ok: false, message: `ค่าต้องอยู่ในรายการ: ${col.enum.join(', ')}` };
      }
      if (col.pattern) {
        let re: RegExp;
        try {
          re = new RegExp(col.pattern);
        } catch {
          return { ok: false, message: `รูปแบบ regex ไม่ถูกต้อง: ${col.pattern}` };
        }
        if (!re.test(text)) {
          return { ok: false, message: `ไม่ตรงกับรูปแบบที่กำหนด (${col.pattern})` };
        }
      }
      return { ok: true, value: text };
    }

    case 'int':
    case 'bigint': {
      const text = cleanNumberText(String(normalized));
      if (!/^[+-]?\d+$/.test(text)) {
        return { ok: false, message: `ไม่ใช่จำนวนเต็ม: ${String(normalized)}` };
      }
      const num = Number(text);
      if (!Number.isSafeInteger(num)) {
        return { ok: false, message: `จำนวนเต็มเกินขอบเขตที่ปลอดภัย: ${text}` };
      }
      if (col.min !== undefined && num < col.min) {
        return { ok: false, message: `ค่าต้องไม่น้อยกว่า ${col.min}` };
      }
      if (col.max !== undefined && num > col.max) {
        return { ok: false, message: `ค่าต้องไม่มากกว่า ${col.max}` };
      }
      return { ok: true, value: num };
    }

    case 'decimal':
    case 'float': {
      const text = cleanNumberText(String(normalized));
      if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) {
        return { ok: false, message: `ไม่ใช่จำนวนทศนิยม: ${String(normalized)}` };
      }
      let num = Number(text);
      if (!Number.isFinite(num)) {
        return { ok: false, message: `จำนวนทศนิยมไม่ถูกต้อง: ${text}` };
      }
      if (col.scale !== undefined) {
        num = Number(num.toFixed(col.scale));
      }
      if (col.min !== undefined && num < col.min) {
        return { ok: false, message: `ค่าต้องไม่น้อยกว่า ${col.min}` };
      }
      if (col.max !== undefined && num > col.max) {
        return { ok: false, message: `ค่าต้องไม่มากกว่า ${col.max}` };
      }
      return { ok: true, value: num };
    }

    case 'bool': {
      const text = String(normalized).trim().toLowerCase();
      if (TRUE_WORDS.has(text)) return { ok: true, value: 1 };
      if (FALSE_WORDS.has(text)) return { ok: true, value: 0 };
      return { ok: false, message: `ค่าบูลไม่ถูกต้อง: ${String(normalized)}` };
    }

    case 'date': {
      const d = toDate(normalized);
      if (!d) return { ok: false, message: `รูปแบบวันที่ไม่ถูกต้อง: ${String(normalized)}` };
      return { ok: true, value: formatDate(d) };
    }

    case 'datetime':
    case 'timestamp': {
      const d = toDate(normalized);
      if (!d) return { ok: false, message: `รูปแบบวันเวลาไม่ถูกต้อง: ${String(normalized)}` };
      return { ok: true, value: formatDateTime(d) };
    }

    case 'json': {
      if (typeof normalized === 'object') {
        return { ok: true, value: JSON.stringify(normalized) };
      }
      const text = String(normalized).trim();
      try {
        JSON.parse(text);
      } catch {
        return { ok: false, message: `JSON ไม่ถูกต้อง: ${text.slice(0, 60)}` };
      }
      return { ok: true, value: text };
    }

    default:
      return { ok: true, value: normalized };
  }
}

function toDate(value: string | number | Date | null): Date | null {
  if (value === null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    // ตัวเลขที่น้อยกว่า 1,000,000 มักเป็น Excel serial
    if (value > 0 && value < 1_000_000) return excelSerialToDate(value);
    return null;
  }
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 0 && serial < 1_000_000) return excelSerialToDate(serial);
  }
  return parseDateInput(text);
}
