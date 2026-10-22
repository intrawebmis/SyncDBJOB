import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbConfig } from '../src/config/env';
import { createAdapter, createPool, detectDialect } from '../src/db/client';
import { createJobLogTables, getColumns, listTables, tableExists } from '../src/db/introspect';
import { runSyncJob } from '../src/core/job';
import type { TargetConfig } from '../src/config/schema';

/**
 * ทดสอบกับ MySQL จริง — จะข้ามอัตโนมัติถ้าไม่ได้เปิดใช้งานด้วย DB_TEST=true
 * วิธีรัน (Windows PowerShell):
 *   $env:DB_TEST='true'; $env:DB_HOST='127.0.0.1'; $env:DB_NAME='syncdb_test'
 *   $env:DB_USER='root'; $env:DB_PASSWORD='xxx'
 *   npx vitest run tests/integration.test.ts
 *
 * ค่าการเชื่อมต่อจะอ่านจาก .env ด้วย ถ้ามีไฟล์ .env อยู่แล้ว
 */
const ENABLED = process.env.DB_TEST === 'true';
const TEST_TABLE = `syncdb_it_${Date.now()}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syncdb-it-'));

let pool: ReturnType<typeof createPool>;
let db: ReturnType<typeof createAdapter>;

beforeAll(async () => {
  if (!ENABLED) return;
  pool = createPool(dbConfig());
  db = createAdapter(pool);
  try {
    await db.query('SELECT 1');
  } catch (err) {
    throw new Error(
      `เชื่อมต่อ MySQL ไม่สำเร็จ (${dbConfig().host}:${dbConfig().port}/${dbConfig().database}): ${(err as Error).message}`,
    );
  }
  await db.query(`CREATE TABLE IF NOT EXISTS \`${TEST_TABLE}\` (
    customer_code VARCHAR(20) NOT NULL,
    customer_name VARCHAR(120) NOT NULL,
    balance DECIMAL(18,2) NULL,
    registered_at DATE NULL,
    source VARCHAR(20) NULL,
    synced_at DATETIME NULL,
    PRIMARY KEY (customer_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}, 30_000);

afterAll(async () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!ENABLED || !pool) return;
  await db.query(`DROP TABLE IF EXISTS \`${TEST_TABLE}\``);
  await db.end();
  await pool.end();
});

function target(): TargetConfig {
  return {
    name: 'it',
    table: TEST_TABLE,
    mode: 'upsert',
    keys: ['customer_code'],
    sheet: undefined,
    headerRow: 1,
    startRow: 2,
    skipEmptyRows: true,
    columns: [
      { excel: 'รหัส', db: 'customer_code', type: 'string', required: true, isKey: true, trim: true, skip: false },
      { excel: 'ชื่อ', db: 'customer_name', type: 'string', required: true, isKey: false, trim: true, skip: false },
      { excel: 'ยอดเงิน', db: 'balance', type: 'decimal', required: false, isKey: false, scale: 2, trim: true, skip: false },
      { excel: 'วันที่', db: 'registered_at', type: 'date', required: false, isKey: false, trim: true, skip: false },
    ],
  } as TargetConfig;
}

async function makeFile(rows: unknown[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('data');
  ws.addRow(['รหัส', 'ชื่อ', 'ยอดเงิน', 'วันที่']);
  for (const r of rows) ws.addRow(r);
  const file = path.join(tmp, `data-${Math.random().toString(36).slice(2)}.xlsx`);
  await wb.xlsx.writeFile(file);
  return file;
}

describe.skipIf(!ENABLED)('integration — MySQL จริง', () => {
  it('เชื่อมต่อฐานข้อมูลได้', async () => {
    const tables = await listTables(db, dbConfig().database);
    expect(Array.isArray(tables)).toBe(true);
    expect(await tableExists(db, TEST_TABLE, dbConfig().database)).toBe(true);
  });

  it('นำเข้าข้อมูลแล้วอัปเดตข้อมูลเดิมได้', async () => {
    const dialect = await detectDialect(pool);
    const file = await makeFile([
      ['C001', 'บริษัท ก', '1500.50', '2024-01-31'],
      ['C002', 'บริษัท ข', '2000', '2024-02-01'],
    ]);

    const first = await runSyncJob({ db, filePath: file, target: target(), dialect });
    expect(first.inserted).toBe(2);
    expect(first.status).toBe('success');

    const updateFile = await makeFile([['C001', 'บริษัท ก ใหม่', '9999.99', '2024-01-31']]);
    const second = await runSyncJob({ db, filePath: updateFile, target: target(), dialect });
    expect(second.updated).toBe(1);

    const rows = await db.query<Array<Record<string, unknown>>>(
      `SELECT customer_code, customer_name, balance FROM \`${TEST_TABLE}\` ORDER BY customer_code`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].customer_name).toBe('บริษัท ก ใหม่');
    expect(Number(rows[0].balance)).toBe(9999.99);
  });

  it('สร้างตารางประวัติการทำงานได้', async () => {
    await createJobLogTables(db);
    const cols = await getColumns(db, 'sync_job_log', dbConfig().database);
    expect(cols.length).toBeGreaterThan(0);
  });
});
