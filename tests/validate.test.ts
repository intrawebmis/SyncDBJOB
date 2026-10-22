import { describe, expect, it } from 'vitest';
import { autoMapColumns, guessType, matchHeader, validateRows } from '../src/core/validate';
import { buildCreateTableSql, buildUpsertSql, quoteIdent, updateColumnsFor } from '../src/core/upsert';
import type { TargetConfig } from '../src/config/schema';

function target(overrides: Partial<TargetConfig> = {}): TargetConfig {
  return {
    name: 'customers',
    table: 'customers',
    mode: 'upsert',
    keys: ['code'],
    sheet: undefined,
    headerRow: 1,
    startRow: 2,
    skipEmptyRows: true,
    columns: [
      { excel: 'รหัส', db: 'code', type: 'string', required: true, isKey: true, trim: true, skip: false },
      { excel: 'ชื่อ', db: 'name', type: 'string', required: false, isKey: false, trim: true, skip: false },
      { excel: 'ยอดเงิน', db: 'balance', type: 'decimal', required: false, isKey: false, trim: true, skip: false, scale: 2 },
    ],
    ...overrides,
  } as TargetConfig;
}

describe('matchHeader', () => {
  it('จับคู่แบบตรงตัวและแบบไม่สนตัวพิมพ์', () => {
    expect(matchHeader(['รหัส', 'ชื่อ'], 'รหัส')).toBe(0);
    expect(matchHeader(['Code', 'Name'], 'code')).toBe(0);
  });

  it('จับคู่แบบละเลยช่องว่าง/ขีดกลาง', () => {
    expect(matchHeader(['Customer Code'], 'customer_code')).toBe(0);
  });

  it('ไม่พบต้องคืน -1', () => {
    expect(matchHeader(['รหัส'], 'ไม่มี')).toBe(-1);
  });
});

describe('validateRows', () => {
  const headers = ['รหัส', 'ชื่อ', 'ยอดเงิน'];

  it('แปลงและตรวจแถวที่ถูกต้อง', () => {
    const result = validateRows(
      headers,
      [{ rowNumber: 2, cells: ['C001', 'บริษัท ก', '1,500.5'] }],
      target(),
    );
    expect(result.totalRows).toBe(1);
    expect(result.validRows).toBe(1);
    expect(result.rows[0].values).toEqual({ code: 'C001', name: 'บริษัท ก', balance: 1500.5 });
  });

  it('รายงานคอลัมน์บังคับที่ว่างและ key ที่หาย', () => {
    const result = validateRows(headers, [{ rowNumber: 5, cells: ['', 'บริษัท ก', ''] }], target());
    expect(result.invalidRows).toBe(1);
    expect(result.issues.some((i) => i.column === 'รหัส')).toBe(true);
    expect(result.issues.some((i) => i.message.includes('key'))).toBe(true);
  });

  it('รายงานค่าผิดรูปแบบตามชนิดข้อมูล', () => {
    const result = validateRows(headers, [{ rowNumber: 3, cells: ['C002', 'x', 'ไม่ใช่ตัวเลข'] }], target());
    expect(result.invalidRows).toBe(1);
    expect(result.issues[0].column).toBe('ยอดเงิน');
    expect(result.issues[0].row).toBe(3);
  });

  it('รองรับคอลัมน์ค่าคงที่ที่ไม่ได้อยู่ใน Excel', () => {
    const t = target();
    t.columns.push({
      excel: '',
      db: 'source',
      type: 'string',
      required: false,
      isKey: false,
      constant: 'excel',
      trim: true,
      skip: false,
    });
    const result = validateRows(headers, [{ rowNumber: 2, cells: ['C001', 'บริษัท ก', '1'] }], t);
    expect(result.rows[0].values.source).toBe('excel');
  });

  it('ใช้ค่า default เมื่อเซลล์ว่าง', () => {
    const t = target();
    t.columns[1].default = 'ไม่ระบุชื่อ';
    const result = validateRows(headers, [{ rowNumber: 2, cells: ['C001', '', '1'] }], t);
    expect(result.rows[0].values.name).toBe('ไม่ระบุชื่อ');
    expect(result.invalidRows).toBe(0);
  });
});

describe('autoMapColumns', () => {
  it('เดาคอลัมน์จากชื่อที่คล้ายกัน', () => {
    const result = autoMapColumns(
      ['Customer Code', 'Customer Name', 'ยอดเงิน'],
      [
        { name: 'customer_code', dataType: 'varchar' },
        { name: 'customer_name', dataType: 'varchar' },
        { name: 'amount', dataType: 'decimal' },
      ],
    );
    expect(result[0].db).toBe('customer_code');
    expect(result[1].db).toBe('customer_name');
    expect(result[2].matched).toBe(true);
  });

  it('จับคู่หัวตารางภาษาไทยกับชื่อคอลัมน์ภาษาอังกฤษได้', () => {
    const result = autoMapColumns(
      ['รหัสลูกค้า', 'ชื่อลูกค้า', 'ยอดเงิน', 'สถานะ', 'วันที่สมัคร'],
      [
        { name: 'customer_code', dataType: 'varchar' },
        { name: 'customer_name', dataType: 'varchar' },
        { name: 'balance', dataType: 'decimal' },
        { name: 'status', dataType: 'varchar' },
        { name: 'registered_at', dataType: 'date' },
      ],
    );
    expect(result.map((r) => r.db)).toEqual([
      'customer_code',
      'customer_name',
      'balance',
      'status',
      'registered_at',
    ]);
  });
});

describe('guessType', () => {
  it('แปลงชนิดข้อมูล MySQL เป็นชนิดของ mapping', () => {
    expect(guessType('varchar')).toBe('string');
    expect(guessType('int')).toBe('int');
    expect(guessType('bigint')).toBe('bigint');
    expect(guessType('decimal')).toBe('decimal');
    expect(guessType('tinyint(1)')).toBe('bool');
    expect(guessType('datetime')).toBe('datetime');
    expect(guessType('timestamp')).toBe('datetime');
    expect(guessType('json')).toBe('json');
  });
});

describe('buildUpsertSql', () => {
  it('สร้างคำสั่ง upsert แบบ VALUES()', () => {
    const { sql, params } = buildUpsertSql(target(), { code: 'C001', name: 'ก', balance: 10 });
    expect(sql).toBe(
      'INSERT INTO `customers` (`code`, `name`, `balance`) VALUES (?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `balance` = VALUES(`balance`)',
    );
    expect(params).toEqual(['C001', 'ก', 10]);
  });

  it('สร้างคำสั่ง upsert แบบ alias สำหรับ MySQL 8.0.19+', () => {
    const { sql } = buildUpsertSql(target(), { code: 'C001' }, 'odku-alias');
    expect(sql).toContain('AS new ON DUPLICATE KEY UPDATE `name` = new.`name`');
  });

  it('ไม่อัปเดตคอลัมน์ key', () => {
    expect(updateColumnsFor(target())).toEqual(['name', 'balance']);
  });

  it('รองรับโหมด insert', () => {
    const { sql } = buildUpsertSql(target({ mode: 'insert', keys: [] }), { code: 'C001' });
    expect(sql).toBe('INSERT INTO `customers` (`code`, `name`, `balance`) VALUES (?, ?, ?)');
  });

  it('escape ชื่อ identifier', () => {
    expect(quoteIdent('we`ird')).toBe('`we``ird`');
  });
});

describe('buildCreateTableSql', () => {
  it('สร้าง DDL พร้อม primary key', () => {
    const sql = buildCreateTableSql(target());
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `customers`');
    expect(sql).toContain('`code` VARCHAR(255) NOT NULL');
    expect(sql).toContain('`balance` DECIMAL(18, 2) NULL');
    expect(sql).toContain('PRIMARY KEY (`code`)');
    expect(sql).toContain('ENGINE=InnoDB');
  });
});
