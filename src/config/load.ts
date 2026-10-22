import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { MappingConfigSchema, type MappingConfig } from './schema';
import { logger } from '../utils/logger';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** อ่านไฟล์ mapping ได้ทั้งแบบ .yaml/.yml และ .json */
export async function loadMappingFile(filePath: string): Promise<MappingConfig> {
  if (!fs.existsSync(filePath)) {
    throw new ConfigError(`ไม่พบไฟล์ mapping: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = filePath.toLowerCase().endsWith('.json') ? JSON.parse(raw) : YAML.parse(raw);
  } catch (err) {
    throw new ConfigError(`อ่านไฟล์ mapping ไม่ได้ (รูปแบบไม่ถูกต้อง): ${(err as Error).message}`);
  }

  const result = MappingConfigSchema.safeParse(parsed);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`ไฟล์ mapping ไม่ถูกต้อง:\n${lines.join('\n')}`);
  }

  logger.debug('โหลดไฟล์ mapping สำเร็จ', { file: filePath, targets: result.data.targets.length });
  return result.data;
}

/** เขียนไฟล์ mapping ออกเป็น YAML */
export function saveMappingFile(filePath: string, config: MappingConfig): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, YAML.stringify(config, { indent: 2, lineWidth: 120 }), 'utf8');
}

/** หา target จากชื่อ (ถ้าไม่ระบุจะใช้ target แรก) */
export function pickTarget(config: MappingConfig, name?: string): MappingConfig['targets'][number] {
  if (!name) {
    const first = config.targets[0];
    if (!first) throw new ConfigError('ไม่มี target ในไฟล์ mapping');
    return first;
  }
  const found = config.targets.find((t) => t.name === name || t.table === name);
  if (!found) {
    const names = config.targets.map((t) => `${t.name} (${t.table})`).join(', ');
    throw new ConfigError(`ไม่พบ target "${name}" — ที่มี: ${names}`);
  }
  return found;
}
