import { describe, expect, it } from 'vitest';
import { dialectFromVersion } from '../src/db/client';
import { buildUpsertSql } from '../src/core/upsert';
import type { TargetConfig } from '../src/config/schema';

function target(): TargetConfig {
  return {
    table: 'customers',
    mode: 'upsert',
    keys: ['code'],
    columns: [
      { source: 'รหัสลูกค้า', db: 'code', type: 'string', required: true },
      { source: 'ยอดคงเหลือ', db: 'balance', type: 'number' },
    ],
  };
}

describe('dialectFromVersion', () => {
  it('ใช้ alias สำหรับ MySQL 8.0.19 ขึ้นไป', () => {
    expect(dialectFromVersion('8.0.19')).toBe('odku-alias');
    expect(dialectFromVersion('8.0.35')).toBe('odku-alias');
    expect(dialectFromVersion('8.4.0')).toBe('odku-alias');
    expect(dialectFromVersion('9.1.0')).toBe('odku-alias');
  });

  it('ใช้ VALUES() สำหรับ MySQL รุ่นเก่า', () => {
    expect(dialectFromVersion('5.7.44')).toBe('odku-values');
    expect(dialectFromVersion('8.0.18')).toBe('odku-values');
  });

  it('ใช้ VALUES() สำหรับ MariaDB แม้เลขเวอร์ชันจะสูงกว่า MySQL', () => {
    // บั๊กสำคัญ: 10.6.25 > 8.0.19 แต่ MariaDB ไม่รองรับ alias `AS new`
    expect(dialectFromVersion('10.6.25-MariaDB')).toBe('odku-values');
    expect(dialectFromVersion('10.11.6-MariaDB-1:10.11.6+maria~ubu2204')).toBe('odku-values');
    expect(dialectFromVersion('5.5.5-10.6.25-MariaDB')).toBe('odku-values');
    expect(dialectFromVersion('11.4.2-MariaDB')).toBe('odku-values');
  });

  it('fallback ไปที่ VALUES() เมื่ออ่านเวอร์ชันไม่ได้', () => {
    expect(dialectFromVersion('')).toBe('odku-values');
    expect(dialectFromVersion('unknown')).toBe('odku-values');
  });
});

describe('buildUpsertSql ตาม dialect', () => {
  it('odku-values ใช้ VALUES(col) และไม่มี alias', () => {
    const { sql } = buildUpsertSql(target(), { code: 'C001', balance: 10 }, 'odku-values');
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(sql).toContain('`balance` = VALUES(`balance`)');
    expect(sql).not.toContain('AS new');
  });

  it('odku-alias ใช้ alias new', () => {
    const { sql } = buildUpsertSql(target(), { code: 'C001', balance: 10 }, 'odku-alias');
    expect(sql).toContain('AS new ON DUPLICATE KEY UPDATE');
    expect(sql).toContain('`balance` = new.`balance`');
  });

  it('dialect ที่ detect ได้จาก MariaDB ต้องให้ SQL ที่ MariaDB รันได้', () => {
    const dialect = dialectFromVersion('10.6.25-MariaDB');
    const { sql } = buildUpsertSql(target(), { code: 'C001', balance: 10 }, dialect);
    expect(sql).toContain('VALUES(`balance`)');
    expect(sql).not.toContain('AS new');
  });
});
