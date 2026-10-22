import { describe, expect, it } from 'vitest';
import { formatDbDate, toMysqlDateTime } from '../src/db/introspect';

describe('toMysqlDateTime', () => {
  it('แปลง ISO เป็นรูปแบบที่ MySQL DATETIME รับได้', () => {
    const d = new Date(2024, 0, 31, 10, 20, 30);
    expect(toMysqlDateTime(d.toISOString())).toBe('2024-01-31 10:20:30');
  });

  it('คืนค่า null เมื่อค่าไม่ถูกต้อง', () => {
    expect(toMysqlDateTime(null)).toBeNull();
    expect(toMysqlDateTime('ไม่ใช่วันที่')).toBeNull();
  });
});

describe('formatDbDate', () => {
  it('จัดรูปแบบวันที่จาก MySQL ให้อ่านง่าย', () => {
    expect(formatDbDate(new Date(2024, 0, 31, 10, 20, 30))).toBe('2024-01-31 10:20:30');
    expect(formatDbDate('2024-01-31 10:20:30')).toBe('2024-01-31 10:20:30');
    expect(formatDbDate(null)).toBe('');
  });
});
