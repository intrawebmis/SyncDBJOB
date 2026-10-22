import 'dotenv/config';
import { z } from 'zod';

/** ตัวแปร boolean ที่อ่านจาก .env — "false" ต้องไม่กลายเป็น true */
const boolEnv = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v.trim() === '') return def;
      return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
    });

const EnvSchema = z.object({
  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('test'),
  DB_SSL: boolEnv(false),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),

  /**
   * ชนิดของเซิร์ฟเวอร์ฐานข้อมูล — กำหนด syntax ของ ON DUPLICATE KEY UPDATE
   *  - auto   : ตรวจจับอัตโนมัติ (ค่าเริ่มต้น)
   *  - mysql  : MySQL 8.0.19+ ใช้ alias `AS new`
   *  - mariadb: MariaDB ใช้ VALUES() (MariaDB ไม่รองรับ alias)
   */
  DB_DIALECT: z.enum(['auto', 'mysql', 'mariadb']).default('auto'),

  APP_HOST: z.string().default('127.0.0.1'),
  APP_PORT: z.coerce.number().int().positive().default(3000),

  SYNC_ON_ERROR: z.enum(['skip', 'abort']).default('skip'),
  SYNC_BATCH_SIZE: z.coerce.number().int().positive().max(5000).default(1),
  CREATE_JOB_LOG_TABLE: boolEnv(true),

  STORAGE_DIR: z.string().default('storage'),
  CONFIG_DIR: z.string().default('config'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`[config] อ่านค่าจาก .env ไม่สำเร็จ:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  connectTimeout: number;
  poolSize: number;
}

export function dbConfig(overrides: Partial<DbConfig> = {}): DbConfig {
  return {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: env.DB_SSL,
    connectTimeout: env.DB_CONNECT_TIMEOUT_MS,
    poolSize: env.DB_POOL_SIZE,
    ...overrides,
  };
}

/** ซ่อนรหัสผ่านสำหรับแสดงผล */
export function describeDb(cfg: DbConfig): string {
  return `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
}
