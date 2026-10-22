import type { ColumnMapping, TargetConfig } from '../config/schema';
import type { UpsertDialect } from './types';

/** escape ชื่อ identifier (ตาราง/คอลัมน์) กัน SQL injection */
export function quoteIdent(name: string): string {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

export function quoteIdents(names: string[]): string {
  return names.map(quoteIdent).join(', ');
}

export interface SqlStatement {
  sql: string;
  params: unknown[];
}

/** คอลัมน์ที่จะเขียนลง DB (ตัดคอลัมน์ที่ skip ออก) */
export function activeColumns(target: TargetConfig): ColumnMapping[] {
  return target.columns.filter((c) => !c.skip);
}

/** คอลัมน์ที่ต้องอัปเดตเมื่อ upsert */
export function updateColumnsFor(target: TargetConfig): string[] {
  const active = activeColumns(target);
  if (target.updateColumns && target.updateColumns.length > 0) {
    return target.updateColumns;
  }
  const keys = new Set(target.keys);
  return active.map((c) => c.db).filter((c) => !keys.has(c));
}

/**
 * สร้างคำสั่ง INSERT หรือ INSERT ... ON DUPLICATE KEY UPDATE
 * dialect:
 *  - odku-values : ใช้ VALUES(col) รองรับ MySQL 5.7 / 8.0 ทุกเวอร์ชัน (deprecated ใน 8.0.20+)
 *  - odku-alias  : ใช้ alias ตามมาตรฐานของ MySQL 8.0.19+
 */
export function buildUpsertSql(
  target: TargetConfig,
  values: Record<string, unknown>,
  dialect: UpsertDialect = 'odku-values',
): SqlStatement {
  const cols = activeColumns(target);
  const names = cols.map((c) => c.db);
  const params = cols.map((c) => values[c.db] ?? null);

  const insertPart = `INSERT INTO ${quoteIdent(target.table)} (${quoteIdents(names)}) VALUES (${names
    .map(() => '?')
    .join(', ')})`;

  if (target.mode === 'insert') {
    return { sql: insertPart, params };
  }

  const updateCols = updateColumnsFor(target);
  if (updateCols.length === 0) {
    // ไม่มีคอลัมน์ที่จะอัปเดต -> ใช้ INSERT IGNORE
    return { sql: insertPart.replace(/^INSERT INTO/, 'INSERT IGNORE INTO'), params };
  }

  const setClause =
    dialect === 'odku-alias'
      ? updateCols.map((c) => `${quoteIdent(c)} = new.${quoteIdent(c)}`).join(', ')
      : updateCols.map((c) => `${quoteIdent(c)} = VALUES(${quoteIdent(c)})`).join(', ');

  const alias = dialect === 'odku-alias' ? ' AS new' : '';
  return { sql: `${insertPart}${alias} ON DUPLICATE KEY UPDATE ${setClause}`, params };
}

/** สร้างคำสั่ง INSERT แบบหลายแถว (bulk) */
export function buildBulkInsertSql(
  target: TargetConfig,
  rowsList: Array<Record<string, unknown>>,
  dialect: UpsertDialect = 'odku-values',
): SqlStatement {
  const cols = activeColumns(target);
  const names = cols.map((c) => c.db);
  const params: unknown[] = [];
  const tuples: string[] = [];

  for (const values of rowsList) {
    tuples.push(`(${names.map(() => '?').join(', ')})`);
    for (const c of cols) params.push(values[c.db] ?? null);
  }

  const insertPart = `INSERT INTO ${quoteIdent(target.table)} (${quoteIdents(names)}) VALUES ${tuples.join(', ')}`;

  if (target.mode === 'insert') {
    return { sql: insertPart, params };
  }

  const updateCols = updateColumnsFor(target);
  if (updateCols.length === 0) {
    return { sql: insertPart.replace(/^INSERT INTO/, 'INSERT IGNORE INTO'), params };
  }

  const setClause =
    dialect === 'odku-alias'
      ? updateCols.map((c) => `${quoteIdent(c)} = new.${quoteIdent(c)}`).join(', ')
      : updateCols.map((c) => `${quoteIdent(c)} = VALUES(${quoteIdent(c)})`).join(', ');

  const alias = dialect === 'odku-alias' ? ' AS new' : '';
  return { sql: `${insertPart}${alias} ON DUPLICATE KEY UPDATE ${setClause}`, params };
}

/** แปลงชนิดข้อมูลของ mapping เป็นชนิดข้อมูล MySQL */
export function mysqlTypeFor(col: ColumnMapping): string {
  switch (col.type) {
    case 'string':
      return col.maxLength ? `VARCHAR(${col.maxLength})` : 'VARCHAR(255)';
    case 'int':
      return 'INT';
    case 'bigint':
      return 'BIGINT';
    case 'decimal':
      return `DECIMAL(18, ${col.scale ?? 2})`;
    case 'float':
      return 'DOUBLE';
    case 'bool':
      return 'TINYINT(1)';
    case 'date':
      return 'DATE';
    case 'datetime':
      return 'DATETIME';
    case 'timestamp':
      return 'TIMESTAMP';
    case 'json':
      return 'JSON';
    default:
      return 'VARCHAR(255)';
  }
}

/** สร้างคำสั่ง CREATE TABLE จาก mapping (ใช้ตั้งต้นยังไม่มีตารางใน DB) */
export function buildCreateTableSql(target: TargetConfig): string {
  const cols = activeColumns(target);
  const keyCols = target.keys.length > 0 ? target.keys : cols.filter((c) => c.isKey).map((c) => c.db);

  const defs = cols.map((col) => {
    const parts = [quoteIdent(col.db), mysqlTypeFor(col)];
    parts.push(col.required ? 'NOT NULL' : 'NULL');
    if (col.db === 'created_at' && !col.constant) parts.push('DEFAULT CURRENT_TIMESTAMP');
    return parts.join(' ');
  });

  if (keyCols.length > 0) {
    defs.push(`PRIMARY KEY (${quoteIdents(keyCols)})`);
  }

  const engine = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(target.table)} (\n  ${defs.join(',\n  ')}\n) ${engine}`;
}
