import { describe, expect, it } from 'vitest';
import {
  coerceValue,
  excelSerialToDate,
  formatDate,
  isBlank,
  normalizeCell,
  parseDateInput,
} from '../src/core/convert';
import type { ColumnMapping } from '../src/config/schema';

function col(overrides: Partial<ColumnMapping> = {}): ColumnMapping {
  return {
    excel: 'x',
    db: 'x',
    type: 'string',
    required: false,
    isKey: false,
    trim: true,
    skip: false,
    ...overrides,
  };
}

describe('normalizeCell', () => {
  it('รองรับ rich text / formula / hyperlink', () => {
    expect(normalizeCell({ richText: [{ text: 'สวัสดี' }, { text: 'ครับ' }] })).toBe('สวัสดีครับ');
    expect(normalizeCell({ formula: 'A1', result: 42 })).toBe(42);
    expect(normalizeCell({ text: 'คลิก', hyperlink: 'https://example.com' })).toBe('คลิก');
  });

  it('แปลงค่าว่างเป็น null', () => {
    expect(normalizeCell(null)).toBeNull();
    expect(normalizeCell(undefined)).toBeNull();
    expect(normalizeCell({ error: { code: '#N/A' } })).toBeNull();
  });
});

describe('coerceValue — string', () => {
  it('ตัดช่องว่างและตรวจความยาว', () => {
    expect(coerceValue('  ทดสอบ  ', col())).toEqual({ ok: true, value: 'ทดสอบ' });
    const tooLong = coerceValue('abcdef', col({ maxLength: 3 }));
    expect(tooLong.ok).toBe(false);
  });

  it('ตรวจ enum แบบไม่สนตัวพิมพ์', () => {
    expect(coerceValue('ก', col({ enum: ['ก', 'ข'] }))).toEqual({ ok: true, value: 'ก' });
    const bad = coerceValue('ค', col({ enum: ['ก', 'ข'] }));
    expect(bad.ok).toBe(false);
  });

  it('ตรวจ regex', () => {
    expect(coerceValue('A001', col({ pattern: '^[A-Z]\\d{3}$' })).ok).toBe(true);
    expect(coerceValue('xx', col({ pattern: '^[A-Z]\\d{3}$' })).ok).toBe(false);
  });
});

describe('coerceValue — ตัวเลข', () => {
  it('int ต้องเป็นจำนวนเต็ม', () => {
    expect(coerceValue('1,234', col({ type: 'int' }))).toEqual({ ok: true, value: 1234 });
    expect(coerceValue('12.5', col({ type: 'int' })).ok).toBe(false);
    expect(coerceValue('abc', col({ type: 'int' })).ok).toBe(false);
  });

  it('decimal ปัดตาม scale และตรวจขอบเขต', () => {
    expect(coerceValue('1234.567', col({ type: 'decimal', scale: 2 }))).toEqual({ ok: true, value: 1234.57 });
    expect(coerceValue('5', col({ type: 'decimal', min: 10 })).ok).toBe(false);
    expect(coerceValue('50', col({ type: 'decimal', max: 10 })).ok).toBe(false);
  });
});

describe('coerceValue — บูลและวันที่', () => {
  it('รองรับคำภาษาไทยของบูล', () => {
    expect(coerceValue('ใช่', col({ type: 'bool' }))).toEqual({ ok: true, value: 1 });
    expect(coerceValue('ไม่ใช่', col({ type: 'bool' }))).toEqual({ ok: true, value: 0 });
    expect(coerceValue('maybe', col({ type: 'bool' })).ok).toBe(false);
  });

  it('แปลงวันที่จาก Date, ISO และ DD/MM/YYYY', () => {
    expect(coerceValue(new Date(2024, 0, 31), col({ type: 'date' }))).toEqual({ ok: true, value: '2024-01-31' });
    expect(coerceValue('2024-01-31', col({ type: 'date' }))).toEqual({ ok: true, value: '2024-01-31' });
    expect(coerceValue('31/01/2024', col({ type: 'date' }))).toEqual({ ok: true, value: '2024-01-31' });
    expect(coerceValue('2024-01-31 10:20:30', col({ type: 'datetime' }))).toEqual({
      ok: true,
      value: '2024-01-31 10:20:30',
    });
  });

  it('แปลงเลข serial ของ Excel เป็นวันที่', () => {
    const d = excelSerialToDate(45_260); // serial 45260 = 2023-11-30
    expect(d).not.toBeNull();
    expect(formatDate(d!)).toBe('2023-11-30');
    expect(coerceValue(45_260, col({ type: 'date' }))).toEqual({ ok: true, value: '2023-11-30' });
  });

  it('parseDateInput รองรับรูปแบบต่าง ๆ', () => {
    expect(parseDateInput('2024-02-29')?.getFullYear()).toBe(2024);
    expect(parseDateInput('29-02-2024')?.getDate()).toBe(29);
    expect(parseDateInput('ไม่ใช่วันที่')).toBeNull();
  });
});

describe('coerceValue — ค่าว่างและ JSON', () => {
  it('ค่าว่างในคอลัมน์บังคับต้องผิดพลาด', () => {
    const res = coerceValue('', col({ required: true }));
    expect(res.ok).toBe(false);
    expect(coerceValue('   ', col({ required: true })).ok).toBe(false);
    expect(coerceValue(null, col({ required: true })).ok).toBe(false);
    expect(coerceValue('', col({ required: false }))).toEqual({ ok: true, value: null });
  });

  it('JSON ต้อง parse ได้', () => {
    expect(coerceValue('{"a":1}', col({ type: 'json' }))).toEqual({ ok: true, value: '{"a":1}' });
    expect(coerceValue('{oops}', col({ type: 'json' })).ok).toBe(false);
  });

  it('isBlank ตรวจเฉพาะช่องว่าง', () => {
    expect(isBlank('  ')).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank(0)).toBe(false);
    expect(isBlank(false)).toBe(false);
  });
});
