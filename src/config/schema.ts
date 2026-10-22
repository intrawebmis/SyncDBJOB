import { z } from 'zod';

export const COLUMN_TYPES = [
  'string',
  'int',
  'bigint',
  'decimal',
  'float',
  'bool',
  'date',
  'datetime',
  'timestamp',
  'json',
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

const ColumnMappingSchema = z
  .object({
    /** ข้อความหัวตารางในไฟล์ Excel (เทียบแบบไม่สนตัวพิมพ์) */
    excel: z.string().default(''),
    /** ชื่อคอลัมน์ในตาราง MySQL */
    db: z.string().min(1, 'ต้องระบุชื่อคอลัมน์ในฐานข้อมูล (db)'),
    type: z.enum(COLUMN_TYPES).default('string'),
    required: z.boolean().default(false),
    /** ใช้เป็น Primary/Unique key ของการ upsert */
    isKey: z.boolean().default(false),
    /** ค่าคงที่ที่ใส่ให้เสมอ (ใช้กับคอลัมน์ที่ไม่ได้อยู่ใน Excel) */
    constant: z.unknown().optional(),
    /** ค่าเริ่มต้นที่ใช้เมื่อเซลล์ใน Excel ว่างเปล่า */
    default: z.unknown().optional(),
    maxLength: z.number().int().positive().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    /** regex สำหรับตรวจรูปแบบข้อความ */
    pattern: z.string().optional(),
    /** ชุดค่าที่อนุญาต */
    enum: z.array(z.string()).optional(),
    /** จำนวนทศนิยมสำหรับ decimal */
    scale: z.number().int().min(0).max(30).optional(),
    /** ตัดช่องว่างหัวท้าย (string เท่านั้น) */
    trim: z.boolean().default(true),
    /** ข้ามคอลัมน์นี้ (ยังนำเข้าไปแต่ไม่ตรวจสอบ) */
    skip: z.boolean().default(false),
  })
  .strict();

export const TargetSchema = z
  .object({
    /** ชื่อที่แสดงผล */
    name: z.string().min(1).default('target'),
    /** ชื่อตารางใน MySQL */
    table: z.string().min(1),
    /** upsert = INSERT ... ON DUPLICATE KEY UPDATE, insert = INSERT อย่างเดียว */
    mode: z.enum(['upsert', 'insert']).default('upsert'),
    /** คอลัมน์ที่ใช้เป็น key (ต้องระบุอย่างน้อย 1 ตัวเมื่อ mode=upsert) */
    keys: z.array(z.string()).default([]),
    /** คอลัมน์ที่ต้องอัปเดตเมื่อ upsert (ค่าเริ่มต้น = ทุกคอลัมน์ที่ไม่ใช่ key) */
    updateColumns: z.array(z.string()).optional(),
    /** ชื่อ sheet ที่ต้องการ (ถ้าไม่ระบุจะใช้ sheet แรก) */
    sheet: z.string().optional(),
    /** แถวที่เป็นหัวตาราง (1-based) */
    headerRow: z.number().int().min(1).default(1),
    /** แถวแรกที่เป็นข้อมูล (1-based) */
    startRow: z.number().int().min(1).default(2),
    /** ข้ามแถวที่ว่างทั้งหมด */
    skipEmptyRows: z.boolean().default(true),
    /** ข้อมูลอ้างอิง/ข้อความเติมเต็ม */
    columns: z.array(ColumnMappingSchema).min(1, 'ต้องมีการ mapping อย่างน้อย 1 คอลัมน์'),
  })
  .strict()
  .superRefine((target, ctx) => {
    if (target.mode === 'upsert' && target.keys.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['keys'],
        message: 'mode=upsert ต้องระบุ keys อย่างน้อย 1 คอลัมน์',
      });
    }
    const dbCols = new Set<string>();
    for (const col of target.columns) {
      if (dbCols.has(col.db)) {
        ctx.addIssue({ code: 'custom', path: ['columns'], message: `คอลัมน์ db "${col.db}" ถูก map ซ้ำ` });
      }
      dbCols.add(col.db);
    }
    for (const key of target.keys) {
      if (!dbCols.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['keys'], message: `key "${key}" ไม่ได้ถูก map ใน columns` });
      }
    }
  });

export const MappingConfigSchema = z
  .object({
    version: z.number().int().default(1),
    name: z.string().optional(),
    description: z.string().optional(),
    /** ตั้งค่าเพิ่มเติมต่อการเชื่อมต่อ (ค่าจาก .env จะถูกใช้ถ้าไม่ระบุ) */
    connection: z
      .object({
        database: z.string().optional(),
        host: z.string().optional(),
        port: z.number().int().positive().optional(),
      })
      .optional(),
    targets: z.array(TargetSchema).min(1),
  })
  .strict();

export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;
export type TargetConfig = z.infer<typeof TargetSchema>;
export type MappingConfig = z.infer<typeof MappingConfigSchema>;
