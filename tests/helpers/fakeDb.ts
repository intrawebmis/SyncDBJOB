import type { DbAdapter, ExecuteResult } from '../../src/core/types';

export interface FakeRow {
  [key: string]: unknown;
}

/**
 * Fake DB ที่จำลองพฤติกรรม MySQL สำหรับ INSERT ... ON DUPLICATE KEY UPDATE
 * - แทรกแถวใหม่  -> affectedRows = 1
 * - อัปเดตแถวเดิม (ค่าเปลี่ยน) -> affectedRows = 2
 * - อัปเดตแถวเดิม (ค่าเดิม)  -> affectedRows = 0 (MySQL) หรือ 1 (MariaDB)
 */
export class FakeDb implements DbAdapter {
  readonly statements: Array<{ sql: string; params: unknown[] }> = [];
  readonly transactions = { begin: 0, commit: 0, rollback: 0 };
  readonly tables = new Map<string, FakeRow[]>();
  keyColumns: string[] = [];
  failOn: (sql: string, params: unknown[]) => string | null = () => null;
  /** จำลองพฤติกรรม MariaDB: ค่าเดิมคืน affectedRows = 1 (MySQL คืน 0) */
  mariadbUnchangedAffectedRows = 0;

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
    this.statements.push({ sql, params });

    // รองรับคำสั่งตรวจ key ที่มีอยู่: SELECT `k` FROM `t` WHERE (`k`) IN ((?),(?))
    const lookup = /SELECT\s+([\s\S]+?)\s+FROM\s+`([^`]+)`\s+WHERE\s+\(([^)]+)\)\s+IN\s+\(([\s\S]+)\)/i.exec(
      sql,
    );
    if (lookup) {
      const table = lookup[2];
      const keyCols = lookup[3].split(',').map((c) => c.trim().replace(/`/g, ''));
      const rows = this.tables.get(table) ?? [];
      const wanted = new Set<string>();
      for (let i = 0; i + keyCols.length <= params.length; i += keyCols.length) {
        wanted.add(keyCols.map((_, k) => stringify(params[i + k])).join('|'));
      }
      const found = rows.filter((r) =>
        wanted.has(keyCols.map((c) => stringify(r[c])).join('|')),
      );
      return found as T;
    }

    if (/^SELECT/i.test(sql.trim())) return [] as T;
    return undefined as T;
  }

  async execute<T = unknown>(sql: string, params: unknown[] = []): Promise<ExecuteResult<T>> {
    this.statements.push({ sql, params });
    const forced = this.failOn(sql, params);
    if (forced) throw new Error(forced);

    const table = extractTable(sql);
    const rows = this.tables.get(table) ?? [];
    this.tables.set(table, rows);

    const columns = extractColumns(sql);
    const values = columns.map((_, i) => params[i]);
    const record: FakeRow = {};
    columns.forEach((c, i) => (record[c] = values[i]));

    const key = this.keyColumns.map((c) => String(record[c] ?? '')).join('|');
    const existing = rows.find((r) => this.keyColumns.map((c) => String(r[c] ?? '')).join('|') === key);

    if (!existing) {
      rows.push(record);
      return { rows: [], affectedRows: 1, changedRows: 1, insertId: rows.length };
    }

    const same = columns.every((c) => stringify(existing[c]) === stringify(record[c]));
    Object.assign(existing, record);
    return {
      rows: [],
      affectedRows: same ? this.mariadbUnchangedAffectedRows : 2,
      changedRows: same ? 0 : 1,
      insertId: 0,
    };
  }

  async beginTransaction(): Promise<void> {
    this.transactions.begin += 1;
  }
  async commit(): Promise<void> {
    this.transactions.commit += 1;
  }
  async rollback(): Promise<void> {
    this.transactions.rollback += 1;
  }
  async end(): Promise<void> {
    /* noop */
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function extractTable(sql: string): string {
  const m = /INSERT\s+(?:IGNORE\s+)?INTO\s+`([^`]+)`/i.exec(sql);
  return m ? m[1] : 'unknown';
}

function extractColumns(sql: string): string[] {
  const m = /INSERT\s+(?:IGNORE\s+)?INTO\s+`[^`]+`\s*\(([^)]+)\)/i.exec(sql);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((c) => c.trim().replace(/`/g, ''))
    .filter(Boolean);
}
