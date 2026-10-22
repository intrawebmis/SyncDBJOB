import type { DbAdapter, ColumnInfo, TableInfo } from '../core/types';
import { quoteIdent } from '../core/upsert';
import { logger } from '../utils/logger';

export async function listTables(db: DbAdapter, database: string): Promise<TableInfo[]> {
  const rows = await db.query<Array<Record<string, unknown>>>(
    // `rows` เป็น reserved word ใน MariaDB 10.6+ จึงต้องใส่ backtick
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS \`rows\`, TABLE_COMMENT AS \`comment\`
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME`,
    [database],
  );

  const counts = await db.query<Array<{ TABLE_NAME: string; COLUMN_COUNT: number }>>(
    `SELECT TABLE_NAME, COUNT(*) AS COLUMN_COUNT
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      GROUP BY TABLE_NAME`,
    [database],
  );
  const colCount = new Map(counts.map((c) => [c.TABLE_NAME, Number(c.COLUMN_COUNT)]));

  return rows.map((r) => ({
    name: String(r.name),
    type: String(r.type ?? 'BASE TABLE'),
    rows: Number(r.rows ?? 0),
    columns: colCount.get(String(r.name)) ?? 0,
    comment: r.comment === null ? null : String(r.comment),
  }));
}

export async function getColumns(db: DbAdapter, table: string, database?: string): Promise<ColumnInfo[]> {
  // ลำดับพารามิเตอร์ต้องตรงกับลำดับ ? ใน SQL เสมอ: TABLE_NAME ก่อน แล้วค่อย TABLE_SCHEMA
  const params: unknown[] = database ? [table, database] : [table];
  const where = database ? 'AND TABLE_SCHEMA = ?' : '';
  const rows = await db.query<Array<Record<string, unknown>>>(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT, ORDINAL_POSITION
       FROM information_schema.COLUMNS
      WHERE TABLE_NAME = ? ${where}
      ORDER BY ORDINAL_POSITION`,
    params,
  );

  return rows.map((r) => ({
    name: String(r.COLUMN_NAME),
    dataType: String(r.DATA_TYPE),
    columnType: String(r.COLUMN_TYPE),
    isNullable: String(r.IS_NULLABLE).toUpperCase() === 'YES',
    columnKey: String(r.COLUMN_KEY ?? ''),
    defaultValue: r.COLUMN_DEFAULT === null || r.COLUMN_DEFAULT === undefined ? null : String(r.COLUMN_DEFAULT),
    extra: String(r.EXTRA ?? ''),
    comment: r.COLUMN_COMMENT === null || r.COLUMN_COMMENT === undefined ? null : String(r.COLUMN_COMMENT),
    ordinal: Number(r.ORDINAL_POSITION ?? 0),
  }));
}

export async function getPrimaryKeys(db: DbAdapter, table: string, database?: string): Promise<string[]> {
  const params: unknown[] = database ? [table, database] : [table];
  const where = database ? 'AND TABLE_SCHEMA = ?' : '';
  const rows = await db.query<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ${where}
      ORDER BY ORDINAL_POSITION`,
    params,
  );
  return rows.map((r) => r.COLUMN_NAME);
}

export async function tableExists(db: DbAdapter, table: string, database?: string): Promise<boolean> {
  const params: unknown[] = database ? [table, database] : [table];
  const where = database ? 'AND TABLE_SCHEMA = ?' : '';
  const rows = await db.query<Array<{ c: number }>>(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_NAME = ? ${where}`,
    params,
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

export const JOB_LOG_TABLE = 'sync_job_log';
export const JOB_ERROR_TABLE = 'sync_job_error';

export async function createJobLogTables(db: DbAdapter): Promise<void> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(JOB_LOG_TABLE)} (
      job_id VARCHAR(64) NOT NULL,
      job_name VARCHAR(255) NULL,
      file_name VARCHAR(255) NULL,
      sheet_name VARCHAR(255) NULL,
      target_table VARCHAR(255) NULL,
      mode VARCHAR(20) NULL,
      status VARCHAR(20) NOT NULL,
      total_rows INT NOT NULL DEFAULT 0,
      inserted_rows INT NOT NULL DEFAULT 0,
      updated_rows INT NOT NULL DEFAULT 0,
      unchanged_rows INT NOT NULL DEFAULT 0,
      failed_rows INT NOT NULL DEFAULT 0,
      skipped_rows INT NOT NULL DEFAULT 0,
      duration_ms INT NOT NULL DEFAULT 0,
      started_at DATETIME NULL,
      finished_at DATETIME NULL,
      issues MEDIUMTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (job_id, created_at),
      KEY idx_sync_job_log_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(JOB_ERROR_TABLE)} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      job_id VARCHAR(64) NOT NULL,
      row_number INT NULL,
      column_name VARCHAR(255) NULL,
      message TEXT NULL,
      bad_value TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_sync_job_error_job (job_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  logger.debug('สร้างตารางประวัติการทำงานเรียบร้อย');
}

export interface JobLogRecord {
  jobId: string;
  jobName: string | null;
  fileName: string | null;
  sheetName: string | null;
  targetTable: string | null;
  mode: string | null;
  status: string;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  unchangedRows: number;
  failedRows: number;
  skippedRows: number;
  durationMs: number;
  startedAt: string | null;
  finishedAt: string | null;
  issues: string | null;
  createdAt: string;
}

/** แปลง ISO string (2026-10-22T04:00:23.580Z) เป็นรูปแบบที่ MySQL DATETIME รับได้ */
export function toMysqlDateTime(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** แปลงค่าวันที่จาก MySQL เป็นข้อความอ่านง่าย */
export function formatDbDate(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
      `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
    );
  }
  return String(value);
}

export async function writeJobLog(db: DbAdapter, record: Omit<JobLogRecord, 'createdAt'>): Promise<void> {
  await db.query(
    `INSERT INTO ${quoteIdent(JOB_LOG_TABLE)}
       (job_id, job_name, file_name, sheet_name, target_table, mode, status,
        total_rows, inserted_rows, updated_rows, unchanged_rows, failed_rows, skipped_rows,
        duration_ms, started_at, finished_at, issues)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.jobId,
      record.jobName,
      record.fileName,
      record.sheetName,
      record.targetTable,
      record.mode,
      record.status,
      record.totalRows,
      record.insertedRows,
      record.updatedRows,
      record.unchangedRows,
      record.failedRows,
      record.skippedRows,
      record.durationMs,
      toMysqlDateTime(record.startedAt),
      toMysqlDateTime(record.finishedAt),
      record.issues ? record.issues.slice(0, 60_000) : null,
    ],
  );
}

export async function writeJobErrors(
  db: DbAdapter,
  jobId: string,
  errors: Array<{ row: number; column?: string; message: string; value?: unknown }>,
): Promise<void> {
  if (errors.length === 0) return;
  for (const e of errors) {
    await db.query(
      `INSERT INTO ${quoteIdent(JOB_ERROR_TABLE)} (job_id, row_number, column_name, message, bad_value)
       VALUES (?, ?, ?, ?, ?)`,
      [jobId, e.row ?? null, e.column ?? null, e.message.slice(0, 2000), e.value === undefined ? null : String(e.value).slice(0, 1000)],
    );
  }
}

export async function listJobLogs(db: DbAdapter, limit = 50): Promise<JobLogRecord[]> {
  const rows = await db.query<Array<Record<string, unknown>>>(
    `SELECT job_id, job_name, file_name, sheet_name, target_table, mode, status,
            total_rows, inserted_rows, updated_rows, unchanged_rows, failed_rows, skipped_rows,
            duration_ms, started_at, finished_at, issues, created_at
       FROM ${quoteIdent(JOB_LOG_TABLE)}
      ORDER BY created_at DESC
      LIMIT ?`,
    [limit],
  );

  return rows.map((r) => ({
    jobId: String(r.job_id),
    jobName: r.job_name === null ? null : String(r.job_name),
    fileName: r.file_name === null ? null : String(r.file_name),
    sheetName: r.sheet_name === null ? null : String(r.sheet_name),
    targetTable: r.target_table === null ? null : String(r.target_table),
    mode: r.mode === null ? null : String(r.mode),
    status: String(r.status),
    totalRows: Number(r.total_rows ?? 0),
    insertedRows: Number(r.inserted_rows ?? 0),
    updatedRows: Number(r.updated_rows ?? 0),
    unchangedRows: Number(r.unchanged_rows ?? 0),
    failedRows: Number(r.failed_rows ?? 0),
    skippedRows: Number(r.skipped_rows ?? 0),
    durationMs: Number(r.duration_ms ?? 0),
    startedAt: r.started_at === null ? null : formatDbDate(r.started_at),
    finishedAt: r.finished_at === null ? null : formatDbDate(r.finished_at),
    issues: r.issues === null ? null : String(r.issues),
    createdAt: formatDbDate(r.created_at),
  }));
}

export async function getJobErrors(db: DbAdapter, jobId: string): Promise<Array<Record<string, unknown>>> {
  return db.query<Array<Record<string, unknown>>>(
    `SELECT row_number, column_name, message, bad_value, created_at
       FROM ${quoteIdent(JOB_ERROR_TABLE)}
      WHERE job_id = ?
      ORDER BY id`,
    [jobId],
  );
}
