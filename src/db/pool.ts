import type { Pool } from 'mysql2/promise';
import { createPool } from './client';
import { dbConfig } from '../config/env';

let poolInstance: Pool | null = null;

/** Pool กลางของทั้งระบบ — ใช้ร่วมกันทุกจุดเพื่อไม่ให้เปิด connection เกินจำเป็น */
export function getPool(): Pool {
  if (!poolInstance) poolInstance = createPool(dbConfig());
  return poolInstance;
}

/** ปิด pool (ใช้ตอนจบโปรแกรม / เทสต์) */
export async function closePool(): Promise<void> {
  if (!poolInstance) return;
  const pool = poolInstance;
  poolInstance = null;
  await pool.end();
}
