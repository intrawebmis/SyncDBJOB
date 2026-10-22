import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { MappingConfigSchema, type MappingConfig } from '../config/schema';
import { logger } from '../utils/logger';

const storageRoot = path.resolve(process.cwd(), env.STORAGE_DIR);
export { storageRoot };
export const mappingsDir = path.join(storageRoot, 'mappings');
export const uploadsDir = path.join(storageRoot, 'uploads');

export interface StoredMapping {
  id: string;
  name: string;
  updatedAt: string;
  config: MappingConfig;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function saveMapping(id: string, name: string, config: MappingConfig): StoredMapping {
  ensureDir(mappingsDir);
  const parsed = MappingConfigSchema.parse(config);
  const file = path.join(mappingsDir, `${id}.json`);
  const record = {
    id,
    name,
    updatedAt: new Date().toISOString(),
    config: parsed,
  };
  fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');
  logger.info('บันทึก mapping สำเร็จ', { id, name });
  return record;
}

export function listMappings(): Array<{ id: string; name: string; updatedAt: string; summary: string }> {
  ensureDir(mappingsDir);
  return fs
    .readdirSync(mappingsDir)
    .filter((f) => f.endsWith('.json'))
    .map((file) => {
      const raw = JSON.parse(fs.readFileSync(path.join(mappingsDir, file), 'utf8')) as StoredMapping;
      return {
        id: raw.id,
        name: raw.name || raw.id,
        updatedAt: raw.updatedAt,
        summary: raw.config.targets.map((t) => `${t.table} (${t.columns.length} คอลัมน์)`).join(', '),
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getMapping(id: string): StoredMapping | null {
  const file = path.join(mappingsDir, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as StoredMapping;
}

export function deleteMapping(id: string): boolean {
  const file = path.join(mappingsDir, `${id}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export interface StoredUpload {
  id: string;
  fileName: string;
  storedName: string;
  path: string;
  size: number;
  uploadedAt: string;
}

export function saveUpload(buffer: Buffer, originalName: string): StoredUpload {
  ensureDir(uploadsDir);
  const id = randomUUID();
  const ext = path.extname(originalName).toLowerCase() || '.xlsx';
  const storedName = `${id}${ext}`;
  const dest = path.join(uploadsDir, storedName);
  fs.writeFileSync(dest, buffer);
  return {
    id,
    fileName: originalName,
    storedName,
    path: dest,
    size: buffer.length,
    uploadedAt: new Date().toISOString(),
  };
}

export function getUpload(id: string): StoredUpload | null {
  ensureDir(uploadsDir);
  const files = fs.readdirSync(uploadsDir);
  const match = files.find((f) => f.startsWith(id));
  if (!match) return null;
  const full = path.join(uploadsDir, match);
  const stat = fs.statSync(full);
  return {
    id,
    fileName: match.slice(id.length + 1) || match,
    storedName: match,
    path: full,
    size: stat.size,
    uploadedAt: stat.mtime.toISOString(),
  };
}

export function deleteUpload(id: string): boolean {
  const upload = getUpload(id);
  if (!upload) return false;
  fs.unlinkSync(upload.path);
  return true;
}

export function listUploads(): Array<{ id: string; fileName: string; size: number; uploadedAt: string }> {
  ensureDir(uploadsDir);
  return fs
    .readdirSync(uploadsDir)
    .map((f) => {
      const stat = fs.statSync(path.join(uploadsDir, f));
      const id = f.split('.')[0];
      return { id, fileName: f.slice(id.length + 1), size: stat.size, uploadedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}
