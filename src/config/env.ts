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
  /**
   * พอร์ตของ Web UI
   * ถ้าไม่ได้ตั้งเอง ระบบจะใช้ค่า PORT ที่ host ให้มา (cPanel / Passenger / Heroku-style)
   */
  APP_PORT: z.coerce.number().int().positive().default(Number(process.env.PORT) || 3000),

  /**
   * ฐานพาธที่แอปถูก mount ไว้ (ถ้าว่าง = อยู่ที่ root)
   * ใช้กรณีติดตั้งใต้ subfolder เช่น ebcitrade.com/SyncJOB → APP_BASE_PATH=/SyncJOB
   */
  APP_BASE_PATH: z.string().default(''),

  // ===== ระบบล็อกอิน =====
  /** เปิด/ปิดระบบล็อกอิน (true = ต้องล็อกอินก่อนใช้งาน) */
  APP_AUTH_ENABLED: boolEnv(true),
  /** ตารางที่เก็บผู้ใช้ (ต้องมีคอลัมน์ USERNAME, PASSWORD_HASH, USER_ACTIVE) */
  AUTH_USERS_TABLE: z.string().default('newfin_users'),
  /** คีย์สำหรับเซ็น cookie (ถ้าเว้นว่างจะสร้างและบันทึกไว้ใน storage/) */
  APP_SESSION_SECRET: z.string().default(''),
  /** อายุ session (ชั่วโมง) */
  APP_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  /** จำนวนครั้งที่ login ผิดพลาดได้ ก่อนล็อกบัญชีชั่วคราว */
  APP_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  /** เวลาล็อกบัญชีชั่วคราว (นาที) */
  APP_LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  /** เชื่อ proxy ข้างหน้า (nginx) — ใช้หา IP จริงของผู้ใช้ */
  APP_TRUST_PROXY: boolEnv(false),

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
