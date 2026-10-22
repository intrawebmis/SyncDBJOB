import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it } from 'vitest';
import { runSyncJob, decomposeCounts, summarize } from '../src/core/job';
import type { TargetConfig } from '../src/config/schema';
import { FakeDb } from './helpers/fakeDb';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syncdb-job-'));

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function makeWorkbook(fileName: string, rows: unknown[][], sheetName = 'Sheet1'): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(sheetName);
  ws.addRow(['รหัส', 'ชื่อ', 'ยอดเงิน', 'วันที่']);
  for (const row of rows) ws.addRow(row);
  const file = path.join(tmp, fileName);
  await workbook.xlsx.writeFile(file);
  return file;
}

function target(overrides: Partial<TargetConfig> = {}): TargetConfig {
  return {
    name: 'customers',
    table: 'customers',
    mode: 'upsert',
    keys: ['code'],
    sheet: 'Sheet1',
    headerRow: 1,
    startRow: 2,
    skipEmptyRows: true,
    columns: [
      { excel: 'รหัส', db: 'code', type: 'string', required: true, isKey: true, trim: true, skip: false },
      { excel: 'ชื่อ', db: 'name', type: 'string', required: false, isKey: false, trim: true, skip: false },
      { excel: 'ยอดเงิน', db: 'balance', type: 'decimal', required: false, isKey: false, trim: true, skip: false, scale: 2 },
      { excel: 'วันที่', db: 'created_on', type: 'date', required: false, isKey: false, trim: true, skip: false },
    ],
    ...overrides,
  } as TargetConfig;
}

describe('runSyncJob', () => {
  it('เพิ่มข้อมูลใหม่และบันทึกลงฐานข้อมูล', async () => {
    const file = await makeWorkbook('insert.xlsx', [
      ['C001', 'บริษัท ก', '1000', '2024-01-31'],
      ['C002', 'บริษัท ข', '2000', '2024-02-01'],
    ]);
    const db = new FakeDb();
    db.keyColumns = ['code'];

    const result = await runSyncJob({ db, filePath: file, target: target() });

    expect(result.status).toBe('success');
    expect(result.totalRows).toBe(2);
    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
    expect(db.transactions.begin).toBe(1);
    expect(db.transactions.commit).toBe(1);
    expect(db.tables.get('customers')).toHaveLength(2);
    expect(db.tables.get('customers')![0]).toMatchObject({
      code: 'C001',
      name: 'บริษัท ก',
      balance: 1000,
      created_on: '2024-01-31',
    });
  });

  it('อัปเดตข้อมูลเดิมเมื่อรันซ้ำ (upsert)', async () => {
    const first = await makeWorkbook('upsert-1.xlsx', [['C001', 'บริษัท ก', '1000', '2024-01-31']]);
    const second = await makeWorkbook('upsert-2.xlsx', [['C001', 'บริษัท ก ใหม่', '1500', '2024-01-31']]);
    const db = new FakeDb();
    db.keyColumns = ['code'];

    const firstRun = await runSyncJob({ db, filePath: first, target: target() });
    expect(firstRun.inserted).toBe(1);

    const secondRun = await runSyncJob({ db, filePath: second, target: target() });

    expect(secondRun.inserted).toBe(0);
    expect(secondRun.updated).toBe(1);
    expect(secondRun.status).toBe('success');
    expect(db.tables.get('customers')).toHaveLength(1);
    expect(db.tables.get('customers')![0]).toMatchObject({ name: 'บริษัท ก ใหม่', balance: 1500 });
  });

  it('รายงานแถวที่ค่าไม่เปลี่ยนเป็น unchanged เมื่อรันซ้ำด้วยข้อมูลเดิม', async () => {
    const file = await makeWorkbook('same.xlsx', [['C001', 'บริษัท ก', '1000', '2024-01-31']]);
    const db = new FakeDb();
    db.keyColumns = ['code'];

    await runSyncJob({ db, filePath: file, target: target() });
    const second = await runSyncJob({ db, filePath: file, target: target() });

    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(db.tables.get('customers')).toHaveLength(1);
  });

  it('ข้ามแถวที่ข้อมูลไม่ผ่านการตรวจสอบ และนำเข้าแถวที่ถูกต้องต่อ', async () => {
    const file = await makeWorkbook('invalid.xlsx', [
      ['C001', 'บริษัท ก', '1000', '2024-01-31'],
      ['', 'ไม่มีรหัส', 'x', 'ไม่ใช่วันที่'],
    ]);
    const db = new FakeDb();
    db.keyColumns = ['code'];

    const result = await runSyncJob({ db, filePath: file, target: target() });

    expect(result.totalRows).toBe(2);
    expect(result.inserted).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.status).toBe('partial');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.row === 3)).toBe(true);
  });

  it('ย้อนกลับธุรกรรมทั้งหมดเมื่อ onError=abort', async () => {
    const file = await makeWorkbook('abort.xlsx', [
      ['C001', 'บริษัท ก', '1000', '2024-01-31'],
      ['', 'ไม่มีรหัส', '1', '2024-01-31'],
    ]);
    const db = new FakeDb();
    db.keyColumns = ['code'];

    const result = await runSyncJob({ db, filePath: file, target: target(), onError: 'abort' });

    expect(result.status).toBe('failed');
    expect(result.inserted).toBe(0);
    expect(db.transactions.rollback).toBe(1);
    expect(db.transactions.commit).toBe(0);
  });

  it('แยกแถวที่ฐานข้อมูลปฏิเสธออกจากแถวอื่น', async () => {
    const file = await makeWorkbook('dberror.xlsx', [
      ['C001', 'บริษัท ก', '1000', '2024-01-31'],
      ['C002', 'บริษัท ข', '2000', '2024-01-31'],
    ]);
    const db = new FakeDb();
    db.keyColumns = ['code'];
    db.failOn = (sql, params) => (params[0] === 'C002' ? "Duplicate entry 'C002' for key 'PRIMARY'" : null);

    const result = await runSyncJob({ db, filePath: file, target: target() });

    expect(result.inserted).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.issues[0].message).toContain('Duplicate entry');
  });

  it('ใช้ค่าคงที่ {{now}} ได้', async () => {
    const file = await makeWorkbook('now.xlsx', [['C001', 'ก', '1', '2024-01-31']]);
    const t = target();
    t.columns.push({
      excel: '',
      db: 'synced_at',
      type: 'datetime',
      required: false,
      isKey: false,
      constant: '{{now}}',
      trim: true,
      skip: false,
    });
    const db = new FakeDb();
    db.keyColumns = ['code'];

    const result = await runSyncJob({ db, filePath: file, target: t });

    expect(result.status).toBe('success');
    const syncedAt = db.tables.get('customers')![0].synced_at as string;
    expect(syncedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('สรุปผลได้อ่านง่าย', async () => {
    const file = await makeWorkbook('summary.xlsx', [['C001', 'ก', '1', '2024-01-31']]);
    const db = new FakeDb();
    db.keyColumns = ['code'];
    const result = await runSyncJob({ db, filePath: file, target: target() });
    expect(summarize(result)).toContain('เพิ่มใหม่ 1');
  });
});

describe('decomposeCounts', () => {
  it('แยกจำนวน insert/update/unchanged จาก affectedRows และ changedRows', () => {
    // 2 แถว: 1 insert (1,1) + 1 update ที่ค่าเปลี่ยน (2,1)
    expect(decomposeCounts(3, 2, 2)).toEqual({ inserted: 1, updated: 1, unchanged: 0 });
    // 1 insert + 1 update ที่ค่าเดิม (0,0)
    expect(decomposeCounts(1, 1, 2)).toEqual({ inserted: 1, updated: 0, unchanged: 1 });
  });
});
