import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readSheet } from '../excel/reader';
import { validateRows } from './validate';
import {
  buildBulkInsertSql,
  buildKeyLookupSql,
  buildUpsertSql,
  keySignature,
  keyTuple,
} from './upsert';
import { formatDateTime } from './convert';
import type { TargetConfig } from '../config/schema';
import type { DbAdapter, JobResult, RowIssue, RowOutcome, UpsertDialect } from './types';
import { logger } from '../utils/logger';

export interface SyncJobOptions {
  db: DbAdapter;
  filePath: string;
  fileName?: string;
  target: TargetConfig;
  dialect?: UpsertDialect;
  /** skip = ข้ามแถวที่ผิดพลาด, abort = ย้อนกลับทั้งหมด */
  onError?: 'skip' | 'abort';
  /** 1 = ทีละแถว (นับ insert/update แม่นยำ), >1 = รวมหลายแถวต่อคำสั่ง */
  batchSize?: number;
  /** true = ตรวจสอบอย่างเดียว ไม่เขียนอะไรลงฐานข้อมูล */
  dryRun?: boolean;
  jobName?: string;
  jobId?: string;
  now?: () => Date;
}

export class SyncAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncAbortedError';
  }
}

const NOW_TOKEN = '{{now}}';
const TODAY_TOKEN = '{{today}}';

/** แปลงค่าคงที่พิเศษ เช่น {{now}} ให้เป็นค่า ณ ปัจจุบัน */
function resolveConstants(target: TargetConfig, now: Date): TargetConfig {
  return {
    ...target,
    columns: target.columns.map((col) => {
      if (col.constant === NOW_TOKEN) return { ...col, constant: formatDateTime(now) };
      if (col.constant === TODAY_TOKEN) return { ...col, constant: formatDateTime(now).slice(0, 10) };
      return col;
    }),
  };
}

function classify(affectedRows: number): 'inserted' | 'updated' | 'unchanged' {
  if (affectedRows === 1) return 'inserted';
  if (affectedRows === 0) return 'unchanged';
  return 'updated';
}

/**
 * ตรวจว่า key ใดมีอยู่ในตารางแล้วบ้าง (ก่อนเขียน)
 *
 * จำเป็นเพราะ MariaDB คืน affectedRows=1 ทั้งตอน "insert ใหม่" และ "update ที่ค่าไม่เปลี่ยน"
 * ทำให้แยกสองกรณีนี้จาก affectedRows อย่างเดียวไม่ได้
 */
export async function findExistingKeys(
  db: DbAdapter,
  target: TargetConfig,
  rows: Array<Record<string, unknown>>,
): Promise<Set<string>> {
  const found = new Set<string>();
  if (target.keys.length === 0 || rows.length === 0) return found;

  const tuples = rows.map((r) => keyTuple(target, r));
  const CHUNK = 500;
  for (let i = 0; i < tuples.length; i += CHUNK) {
    const chunk = tuples.slice(i, i + CHUNK);
    const { sql, params } = buildKeyLookupSql(target, chunk);
    try {
      const existing = await db.query<Array<Record<string, unknown>>>(sql, params);
      for (const row of existing) {
        const sig = keySignature(target.keys.map((k) => row[k] ?? null));
        found.add(sig);
      }
    } catch (err) {
      // ถ้าตรวจไม่ได้ (เช่น คอลัมน์ key ไม่ได้อยู่ในตาราง) ให้ข้ามไป ไม่ให้ล้มทั้งงาน
      logger.warn('ตรวจสอบ key ที่มีอยู่ไม่สำเร็จ (จะนับจำนวนได้ไม่ละเอียด)', (err as Error).message);
      return found;
    }
  }
  return found;
}

/**
 * จัดประเภทผลลัพธ์ของแถวหนึ่ง
 * @param existed มี key นี้ในตารางอยู่แล้วหรือไม่ (ก่อนเขียน)
 */
export function classifyRow(
  affectedRows: number,
  existed: boolean | undefined,
): 'inserted' | 'updated' | 'unchanged' {
  if (existed === undefined) return classify(affectedRows);
  if (!existed) return 'inserted';
  // มีอยู่แล้ว: affectedRows=2 คือค่าเปลี่ยน, 1 คือค่าเดิม (MariaDB) / 0 (MySQL)
  return affectedRows >= 2 ? 'updated' : 'unchanged';
}

function dbErrorMessage(err: unknown): string {
  const e = err as { code?: string; sqlMessage?: string; message?: string };
  if (e?.sqlMessage) return `${e.code ? `[${e.code}] ` : ''}${e.sqlMessage}`;
  if (e?.code) return `[${e.code}] ${e.message ?? 'database error'}`;
  return e?.message ?? String(err);
}

/**
 * นำเข้าข้อมูลจากไฟล์ Excel ลงตาราง MySQL
 * คืนค่าผลลัพธ์พร้อมสถานะของแต่ละแถว
 */
export async function runSyncJob(options: SyncJobOptions): Promise<JobResult> {
  const {
    db,
    filePath,
    target: rawTarget,
    dialect = 'odku-values',
    onError = 'skip',
    batchSize = 1,
    dryRun = false,
    jobName,
  } = options;

  const startedAt = options.now ? options.now() : new Date();
  const jobId = options.jobId ?? randomUUID();
  const target = resolveConstants(rawTarget, startedAt);
  const fileName = options.fileName ?? path.basename(filePath);

  const data = await readSheet(filePath, {
    sheet: target.sheet,
    headerRow: target.headerRow,
    startRow: target.startRow,
  });

  const validation = validateRows(data.headers, data.rows, target);

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let skipped = 0;

  const issues: RowIssue[] = [];
  const outcomes: RowOutcome[] = [];

  const validRows = validation.rows.filter((r) => r.issues.length === 0);
  const invalidRows = validation.rows.filter((r) => r.issues.length > 0);

  const abort = (rowNumber: number, message: string): never => {
    throw new SyncAbortedError(`ยกเลิกการนำเข้าที่แถว ${rowNumber}: ${message}`);
  };

  const buildResult = (): JobResult => {
    const finishedAt = new Date();
    const status: JobResult['status'] =
      failed === 0 ? 'success' : validation.totalRows === failed ? 'failed' : 'partial';
    return {
      jobId,
      jobName: jobName ?? target.name,
      fileName,
      sheet: data.sheet,
      table: target.table,
      mode: target.mode,
      status,
      totalRows: validation.totalRows,
      inserted,
      updated,
      unchanged,
      failed,
      skipped,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      issues,
      outcomes,
    };
  };

  await db.beginTransaction();
  try {
    if (invalidRows.length > 0 && onError === 'abort') {
      abort(invalidRows[0].rowNumber, `พบ ${invalidRows.length} แถวที่ไม่ผ่านการตรวจสอบ (ยกเลิกทั้งงาน)`);
    }

    for (const row of invalidRows) {
      failed += 1;
      issues.push(...row.issues);
      outcomes.push({
        rowNumber: row.rowNumber,
        result: 'failed',
        message: row.issues.map((i) => `${i.column ? `[${i.column}] ` : ''}${i.message}`).join('; '),
      });
    }

    // ตรวจสอบ key ที่มีอยู่แล้วก่อนเขียน เพื่อให้นับ "เพิ่มใหม่ / อัปเดต / ไม่เปลี่ยน" แม่นยำ
    // (MariaDB คืน affectedRows=1 ทั้งตอน insert ใหม่และ update ที่ค่าไม่เปลี่ยน)
    const existingKeys = await findExistingKeys(
      db,
      target,
      validRows.map((r) => r.values),
    );
    const existedOf = (values: Record<string, unknown>): boolean | undefined => {
      if (target.keys.length === 0) return undefined;
      return existingKeys.has(keySignature(keyTuple(target, values)));
    };

    if (dryRun) {
      // โหมดทดลอง: ไม่เขียนอะไรลงฐานข้อมูลเลย แต่ยังรายงานว่าจะเพิ่มใหม่/อัปเดตกี่แถว
      for (const row of validRows) {
        const result: RowOutcome['result'] = existedOf(row.values) ? 'updated' : 'inserted';
        if (result === 'inserted') inserted += 1;
        else updated += 1;
        outcomes.push({ rowNumber: row.rowNumber, result });
      }
      return buildResult();
    }

    if (batchSize <= 1) {
      for (const row of validRows) {
        try {
          const { sql, params } = buildUpsertSql(target, row.values, dialect);
          const res = await db.execute(sql, params);
          const result = classifyRow(res.affectedRows, existedOf(row.values));
          if (result === 'inserted') inserted += 1;
          else if (result === 'updated') updated += 1;
          else unchanged += 1;
          outcomes.push({ rowNumber: row.rowNumber, result });
        } catch (err) {
          const message = dbErrorMessage(err);
          failed += 1;
          issues.push({ row: row.rowNumber, message });
          outcomes.push({ rowNumber: row.rowNumber, result: 'failed', message });
          if (onError === 'abort') abort(row.rowNumber, message);
        }
      }
    } else {
      for (let i = 0; i < validRows.length; i += batchSize) {
        const chunk = validRows.slice(i, i + batchSize);
        try {
          const { sql, params } = buildBulkInsertSql(target, chunk.map((r) => r.values), dialect);
          const res = await db.execute(sql, params);
          const counts = decomposeCounts(res.affectedRows, res.changedRows, chunk.length);
          inserted += counts.inserted;
          updated += counts.updated;
          unchanged += counts.unchanged;
          for (const row of chunk) {
            outcomes.push({ rowNumber: row.rowNumber, result: 'unchanged' });
          }
        } catch (err) {
          // กลับไปทำทีละแถวเพื่อหาแถวที่มีปัญหาจริง ๆ
          logger.warn(`คำสั่ง bulk ล้มเหลว (${chunk.length} แถว) กำลังลองทีละแถว`, dbErrorMessage(err));
          for (const row of chunk) {
            try {
              const { sql, params } = buildUpsertSql(target, row.values, dialect);
              const res = await db.execute(sql, params);
              const result = classifyRow(res.affectedRows, existedOf(row.values));
              if (result === 'inserted') inserted += 1;
              else if (result === 'updated') updated += 1;
              else unchanged += 1;
              outcomes.push({ rowNumber: row.rowNumber, result });
            } catch (rowErr) {
              const message = dbErrorMessage(rowErr);
              failed += 1;
              issues.push({ row: row.rowNumber, message });
              outcomes.push({ rowNumber: row.rowNumber, result: 'failed', message });
              if (onError === 'abort') abort(row.rowNumber, message);
            }
          }
        }
      }
    }

    await db.commit();
  } catch (err) {
    await db.rollback();
    const message = err instanceof SyncAbortedError ? err.message : dbErrorMessage(err);
    logger.error('การนำเข้าข้อมูลล้มเหลว ย้อนกลับธุรกรรมแล้ว', message);
    const finishedAt = new Date();
    return {
      jobId,
      jobName: jobName ?? target.name,
      fileName,
      sheet: data.sheet,
      table: target.table,
      mode: target.mode,
      status: 'failed',
      totalRows: validation.totalRows,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      failed: validation.totalRows,
      skipped,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      issues: [...issues, { row: 0, message }],
      outcomes,
    };
  }

  return buildResult();
}

/**
 * แยกจำนวนแถวที่ insert / update / ไม่เปลี่ยนแปลง จาก affectedRows และ changedRows
 * ตามหลัก MySQL: ODKU ให้ affectedRows = 1 (insert), 2 (update ที่ค่าเปลี่ยน), 0 (ค่าเดิม)
 */
export function decomposeCounts(affectedRows: number, changedRows: number, rowCount: number): {
  inserted: number;
  updated: number;
  unchanged: number;
} {
  const updated = Math.max(0, affectedRows - changedRows);
  const inserted = Math.max(0, 2 * changedRows - affectedRows);
  const unchanged = Math.max(0, rowCount - inserted - updated);
  const total = inserted + updated + unchanged;
  if (total !== rowCount) {
    // ป้องกันค่าผิดปกติจาก driver
    return { inserted, updated, unchanged: Math.max(0, rowCount - inserted - updated) };
  }
  return { inserted, updated, unchanged };
}

/** สรุปผลการทำงานเป็นข้อความอ่านง่าย */
export function summarize(result: JobResult): string {
  return [
    `งาน: ${result.jobName} (${result.status})`,
    `ไฟล์: ${result.fileName} / sheet: ${result.sheet}`,
    `ตาราง: ${result.table} (${result.mode})`,
    `ทั้งหมด ${result.totalRows} แถว → เพิ่มใหม่ ${result.inserted}, อัปเดต ${result.updated}, ไม่เปลี่ยน ${result.unchanged}, ผิดพลาด ${result.failed}`,
    `ใช้เวลา ${result.durationMs} ms`,
  ].join('\n');
}
