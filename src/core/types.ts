import type { ColumnMapping, TargetConfig } from '../config/schema';

/** สถานะการทำงานของ job */
export type JobStatus = 'running' | 'success' | 'partial' | 'failed';

/** ตัว adapter ของฐานข้อมูล — ใช้ interface เพื่อให้เทสต์ด้วย mock ได้ */
export interface DbAdapter {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
  execute<T = unknown>(sql: string, params?: unknown[]): Promise<ExecuteResult<T>>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  end(): Promise<void>;
}

export interface ExecuteResult<T = unknown> {
  rows: T[];
  affectedRows: number;
  changedRows: number;
  insertId: number;
}

/** ประเภท dialect ของคำสั่ง ON DUPLICATE KEY UPDATE */
export type UpsertDialect = 'odku-values' | 'odku-alias';

export interface RowIssue {
  /** เลขแถวในไฟล์ Excel (1-based รวมแถวหัวตาราง) */
  row: number;
  /** คอลัมน์ที่มีปัญหา (ถ้ามี) */
  column?: string;
  message: string;
  value?: unknown;
}

export interface ValidatedRow {
  /** เลขแถวในไฟล์ Excel */
  rowNumber: number;
  /** ค่าที่พร้อมนำเข้า โดย key คือชื่อคอลัมน์ใน MySQL */
  values: Record<string, unknown>;
  issues: RowIssue[];
}

export interface RowOutcome {
  rowNumber: number;
  result: 'inserted' | 'updated' | 'unchanged' | 'failed';
  message?: string;
}

export interface JobResult {
  jobId: string;
  jobName: string;
  fileName: string;
  sheet: string;
  table: string;
  mode: TargetConfig['mode'];
  status: JobStatus;
  totalRows: number;
  inserted: number;
  updated: number;
  unchanged: number;
  failed: number;
  skipped: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  issues: RowIssue[];
  outcomes: RowOutcome[];
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  columnType: string;
  isNullable: boolean;
  columnKey: string;
  defaultValue: string | null;
  extra: string;
  comment: string | null;
  ordinal: number;
}

export interface TableInfo {
  name: string;
  type: string;
  rows: number;
  columns: number;
  comment: string | null;
}

export type { ColumnMapping, TargetConfig };
