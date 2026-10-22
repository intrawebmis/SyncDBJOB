import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import type { Pool } from 'mysql2/promise';
import { dbConfig, describeDb } from '../config/env';
import { MappingConfigSchema, type MappingConfig } from '../config/schema';
import { createAdapter, createPool, detectDialect, ping } from '../db/client';
import {
  createJobLogTables,
  getColumns,
  getPrimaryKeys,
  getJobErrors,
  listJobLogs,
  listTables,
  tableExists,
  writeJobErrors,
  writeJobLog,
} from '../db/introspect';
import { runSyncJob } from '../core/job';
import { autoMapColumns, guessType, validateRows } from '../core/validate';
import { buildCreateTableSql } from '../core/upsert';
import { detectHeaderRow, listSheets, readSheet } from '../excel/reader';
import { generateTemplate } from '../excel/template';
import {
  deleteMapping,
  deleteUpload,
  getMapping,
  getUpload,
  listMappings,
  listUploads,
  saveMapping,
  saveUpload,
} from '../store/mappings';
import { logger } from '../utils/logger';
import { randomUUID } from 'node:crypto';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

let poolInstance: Pool | null = null;

function getPool(): Pool {
  if (!poolInstance) poolInstance = createPool(dbConfig());
  return poolInstance;
}

function fail(res: Response, status: number, message: string, detail?: unknown): void {
  res.status(status).json({ ok: false, error: message, detail });
}

function wrap(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    handler(req, res).catch((err: Error) => {
      logger.error(`[web] ${err.message}`);
      if (!res.headersSent) fail(res, 500, err.message);
    });
  };
}

/** ดึง mapping จาก body: ใช้ mappingId ที่บันทึกไว้ หรือ config ที่ส่งมาโดยตรง */
function resolveMapping(body: Record<string, unknown>): { config: MappingConfig; id: string | null } {
  const mappingId = typeof body.mappingId === 'string' ? body.mappingId : null;
  if (mappingId) {
    const stored = getMapping(mappingId);
    if (!stored) throw new Error(`ไม่พบ mapping "${mappingId}"`);
    return { config: stored.config, id: stored.id };
  }
  const raw = body.config;
  if (!raw || typeof raw !== 'object') {
    throw new Error('ต้องส่ง mappingId หรือ config');
  }
  const parsed = MappingConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`config ไม่ถูกต้อง — ${issues}`);
  }
  return { config: parsed.data, id: null };
}

function pickTargetOf(config: MappingConfig, name?: string) {
  if (!name) {
    const first = config.targets[0];
    if (!first) throw new Error('ไม่มี target ใน mapping');
    return first;
  }
  const found = config.targets.find((t) => t.name === name || t.table === name);
  if (!found) throw new Error(`ไม่พบ target "${name}"`);
  return found;
}

export function createApiRouter(): Router {
  const router = Router();

  router.get('/health', wrap(async (_req, res) => {
    const pool = getPool();
    const result = await ping(pool);
    res.json({
      ok: true,
      database: describeDb(dbConfig()),
      connected: result.ok,
      version: result.version,
      server: result.server,
    });
  }));

  router.get('/tables', wrap(async (_req, res) => {
    const pool = getPool();
    const db = createAdapter(pool);
    try {
      const tables = await listTables(db, dbConfig().database);
      res.json({ ok: true, tables });
    } finally {
      await db.end();
    }
  }));

  router.get('/tables/:table/schema', wrap(async (req, res) => {
    const table = String(req.params.table);
    const pool = getPool();
    const db = createAdapter(pool);
    try {
      const columns = await getColumns(db, table, dbConfig().database);
      if (columns.length === 0) {
        fail(res, 404, `ไม่พบตาราง "${table}"`);
        return;
      }
      const primaryKeys = await getPrimaryKeys(db, table, dbConfig().database);
      res.json({ ok: true, table, columns, primaryKeys });
    } finally {
      await db.end();
    }
  }));

  router.post('/upload', upload.single('file'), wrap(async (req, res) => {
    const file = req.file;
    if (!file) {
      fail(res, 400, 'ไม่พบไฟล์ (ส่งฟิลด์ชื่อ "file")');
      return;
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xlsm') {
      fail(res, 400, 'รองรับเฉพาะไฟล์ .xlsx / .xlsm');
      return;
    }

    const stored = saveUpload(file.buffer, file.originalname);
    const sheets = await listSheets(stored.path);
    const headerRow = await detectHeaderRow(stored.path, sheets[0]?.name);

    res.json({
      ok: true,
      fileId: stored.id,
      fileName: stored.fileName,
      size: stored.size,
      sheets,
      detectedHeaderRow: headerRow,
    });
  }));

  router.post('/preview', wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const fileId = String(body.fileId ?? '');
    const uploadFile = getUpload(fileId);
    if (!uploadFile) {
      fail(res, 404, 'ไม่พบไฟล์ที่อัปโหลด');
      return;
    }

    const sheet = typeof body.sheet === 'string' && body.sheet ? body.sheet : undefined;
    const headerRow = Number(body.headerRow ?? 1) || 1;
    const limit = Math.min(Number(body.limit ?? 20) || 20, 200);

    const data = await readSheet(uploadFile.path, { sheet, headerRow, startRow: headerRow + 1, maxRows: limit });

    res.json({
      ok: true,
      fileId,
      sheet: data.sheet,
      headers: data.headers,
      rows: data.rows.map((r) => ({
        rowNumber: r.rowNumber,
        cells: r.cells.map((c) => (c instanceof Date ? c.toISOString() : c)),
      })),
      totalRows: data.totalRows,
    });
  }));

  router.post('/auto-map', wrap(async (req, res) => {
    const body = req.body as { headers?: string[]; columns?: Array<{ name: string; dataType: string }> };
    const headers = body.headers ?? [];
    const columns = body.columns ?? [];
    const suggestions = autoMapColumns(headers, columns);
    res.json({
      ok: true,
      suggestions: suggestions.map((s) => ({
        excel: s.excel,
        db: s.db,
        matched: s.matched,
        type: s.db ? guessType(columns.find((c) => c.name === s.db)?.dataType ?? 'varchar') : 'string',
      })),
    });
  }));

  router.get('/mappings', wrap(async (_req, res) => {
    res.json({ ok: true, mappings: listMappings(), uploads: listUploads() });
  }));

  router.get('/mappings/:id', wrap(async (req, res) => {
    const stored = getMapping(String(req.params.id));
    if (!stored) {
      fail(res, 404, 'ไม่พบ mapping');
      return;
    }
    res.json({ ok: true, mapping: stored });
  }));

  router.post('/mappings', wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const { config, id } = resolveMapping(body);
    const name = typeof body.name === 'string' && body.name ? body.name : (config.name ?? config.targets[0].name);
    const mappingId = id ?? randomUUID();
    const stored = saveMapping(mappingId, name, config);
    res.json({ ok: true, mapping: stored });
  }));

  router.delete('/mappings/:id', wrap(async (req, res) => {
    const removed = deleteMapping(String(req.params.id));
    res.json({ ok: removed });
  }));

  router.delete('/uploads/:id', wrap(async (req, res) => {
    const removed = deleteUpload(String(req.params.id));
    res.json({ ok: removed });
  }));

  router.post('/validate', wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const { config } = resolveMapping(body);
    const target = pickTargetOf(config, typeof body.targetName === 'string' ? body.targetName : undefined);

    const fileId = String(body.fileId ?? '');
    const uploadFile = getUpload(fileId);
    if (!uploadFile) {
      fail(res, 404, 'ไม่พบไฟล์ที่อัปโหลด');
      return;
    }

    const data = await readSheet(uploadFile.path, {
      sheet: target.sheet,
      headerRow: target.headerRow,
      startRow: target.startRow,
    });
    const result = validateRows(data.headers, data.rows, target);

    res.json({
      ok: true,
      sheet: data.sheet,
      totalRows: result.totalRows,
      validRows: result.validRows,
      invalidRows: result.invalidRows,
      issues: result.issues.slice(0, 200),
    });
  }));

  router.post('/sync', wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const { config } = resolveMapping(body);
    const target = pickTargetOf(config, typeof body.targetName === 'string' ? body.targetName : undefined);

    const fileId = String(body.fileId ?? '');
    const uploadFile = getUpload(fileId);
    if (!uploadFile) {
      fail(res, 404, 'ไม่พบไฟล์ที่อัปโหลด');
      return;
    }

    const pool = getPool();
    const dialect = await detectDialect(pool);
    const db = createAdapter(pool);
    try {
      const exists = await tableExists(db, target.table, dbConfig().database);
      if (!exists) {
        const allowCreate = body.createTable === true;
        if (!allowCreate) {
          fail(res, 400, `ไม่พบตาราง "${target.table}" — กด "สร้างตาราง" ก่อน หรือเลือกให้สร้างอัตโนมัติ`);
          return;
        }
        await db.query(buildCreateTableSql(target));
      }

      const result = await runSyncJob({
        db,
        filePath: uploadFile.path,
        fileName: uploadFile.fileName,
        target,
        dialect,
        onError: body.onError === 'abort' ? 'abort' : 'skip',
        batchSize: Number(body.batchSize ?? 1) || 1,
        jobName: target.name,
      });

      await createJobLogTables(db);
      await writeJobLog(db, {
        jobId: result.jobId,
        jobName: result.jobName,
        fileName: result.fileName,
        sheetName: result.sheet,
        targetTable: result.table,
        mode: result.mode,
        status: result.status,
        totalRows: result.totalRows,
        insertedRows: result.inserted,
        updatedRows: result.updated,
        unchangedRows: result.unchanged,
        failedRows: result.failed,
        skippedRows: result.skipped,
        durationMs: result.durationMs,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        issues: result.issues.length > 0 ? JSON.stringify(result.issues.slice(0, 200)) : null,
      });
      await writeJobErrors(db, result.jobId, result.issues);

      res.json({ ok: true, result });
    } finally {
      await db.end();
    }
  }));

  router.post('/ddl', wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const { config } = resolveMapping(body);
    const target = pickTargetOf(config, typeof body.targetName === 'string' ? body.targetName : undefined);
    const sql = buildCreateTableSql(target);

    if (body.apply !== true) {
      res.json({ ok: true, sql });
      return;
    }

    const pool = getPool();
    const db = createAdapter(pool);
    try {
      await db.query(sql);
      res.json({ ok: true, sql, applied: true });
    } finally {
      await db.end();
    }
  }));

  router.post('/template', wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const { config } = resolveMapping(body);
    const target = pickTargetOf(config, typeof body.targetName === 'string' ? body.targetName : undefined);
    const outFile = path.resolve(String(body.outFile ?? 'template.xlsx'));
    await generateTemplate(target, outFile);
    res.json({ ok: true, file: outFile });
  }));

  router.get('/jobs', wrap(async (_req, res) => {
    const pool = getPool();
    const db = createAdapter(pool);
    try {
      await createJobLogTables(db);
      const logs = await listJobLogs(db, 50);
      res.json({ ok: true, jobs: logs });
    } finally {
      await db.end();
    }
  }));

  router.get('/jobs/:id/errors', wrap(async (req, res) => {
    const pool = getPool();
    const db = createAdapter(pool);
    try {
      await createJobLogTables(db);
      const errors = await getJobErrors(db, String(req.params.id));
      res.json({ ok: true, errors });
    } finally {
      await db.end();
    }
  }));

  return router;
}
