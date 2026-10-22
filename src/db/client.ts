import mysql, { type Pool, type PoolConnection, type PoolOptions } from 'mysql2/promise';
import { dbConfig, describeDb, env, type DbConfig } from '../config/env';
import { logger } from '../utils/logger';
import type { DbAdapter, ExecuteResult, UpsertDialect } from '../core/types';

export function poolOptions(cfg: DbConfig): PoolOptions {
  return {
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: cfg.poolSize,
    queueLimit: 0,
    connectTimeout: cfg.connectTimeout,
    charset: 'utf8mb4_unicode_ci',
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    ...(cfg.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

export function createPool(cfg: DbConfig = dbConfig()): Pool {
  return mysql.createPool(poolOptions(cfg));
}

/** ตรวจการเชื่อมต่อและคืนค่าเวอร์ชัน MySQL */
export async function ping(pool: Pool): Promise<{ ok: boolean; version: string; server: string }> {
  try {
    const [rows] = await pool.query('SELECT VERSION() AS version, @@hostname AS server');
    const row = (rows as Array<{ version: string; server: string }>)[0];
    return { ok: true, version: row.version, server: row.server };
  } catch (err) {
    return { ok: false, version: '', server: (err as Error).message };
  }
}

/**
 * ตัดสิน syntax ของ ON DUPLICATE KEY UPDATE จากสตริงเวอร์ชันของเซิร์ฟเวอร์ (pure function — เทสต์ได้)
 *
 * ข้อควรระวัง: MariaDB รายงานเวอร์ชันเป็น "10.6.x-MariaDB" หรือ "5.5.5-10.6.x-MariaDB"
 * ซึ่งตัวเลขสูงกว่า MySQL 8.x แต่ **MariaDB ไม่รองรับ alias `AS new`** ต้องใช้ VALUES()
 */
export function dialectFromVersion(version: string): UpsertDialect {
  if (/mariadb/i.test(version)) return 'odku-values';
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return 'odku-values';
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  const supportsAlias = major > 8 || (major === 8 && (minor > 0 || (minor === 0 && patch >= 19)));
  return supportsAlias ? 'odku-alias' : 'odku-values';
}

/**
 * เลือก syntax ของ ON DUPLICATE KEY UPDATE ให้เหมาะกับเซิร์ฟเวอร์
 *  - MariaDB        : ใช้ VALUES(col) เสมอ (MariaDB ไม่รองรับ alias `AS new`)
 *  - MySQL >= 8.0.19 : ใช้ alias ตามมาตรฐานใหม่
 *  - MySQL ต่ำกว่านั้น : ใช้ VALUES(col)
 */
export async function detectDialect(pool: Pool): Promise<UpsertDialect> {
  try {
    if (env.DB_DIALECT === 'mariadb') {
      logger.debug('detectDialect', { dialect: 'odku-values', reason: 'บังคับด้วย DB_DIALECT=mariadb' });
      return 'odku-values';
    }
    const [rows] = await pool.query('SELECT VERSION() AS v');
    const version = String((rows as Array<{ v: string }>)[0]?.v ?? '0');
    const dialect = dialectFromVersion(version);
    logger.debug('detectDialect', { version, dialect });
    return dialect;
  } catch {
    return 'odku-values';
  }
}

/** Adapter สำหรับใช้งานใน job — ถือ connection เดียวไว้เพื่อรองรับ transaction */
export class MysqlAdapter implements DbAdapter {
  private conn: PoolConnection | null = null;

  constructor(private readonly pool: Pool) {}

  private async connection(): Promise<PoolConnection> {
    if (!this.conn) {
      this.conn = await this.pool.getConnection();
    }
    return this.conn;
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
    const conn = await this.connection();
    const [rows] = await conn.query(sql, params);
    return rows as T;
  }

  async execute<T = unknown>(sql: string, params: unknown[] = []): Promise<ExecuteResult<T>> {
    const conn = await this.connection();
    const [res] = await conn.execute(sql, params as never[]);
    const r = res as { affectedRows?: number; changedRows?: number; insertId?: number };
    return {
      rows: Array.isArray(res) ? (res as T[]) : [],
      affectedRows: r.affectedRows ?? 0,
      changedRows: r.changedRows ?? 0,
      insertId: r.insertId ?? 0,
    };
  }

  async beginTransaction(): Promise<void> {
    const conn = await this.connection();
    await conn.beginTransaction();
  }

  async commit(): Promise<void> {
    const conn = await this.connection();
    await conn.commit();
  }

  async rollback(): Promise<void> {
    if (!this.conn) return;
    try {
      await this.conn.rollback();
    } catch (err) {
      logger.warn('rollback ไม่สำเร็จ', (err as Error).message);
    }
  }

  async end(): Promise<void> {
    if (this.conn) {
      this.conn.release();
      this.conn = null;
    }
  }
}

export function createAdapter(pool: Pool): MysqlAdapter {
  return new MysqlAdapter(pool);
}

export { describeDb };
