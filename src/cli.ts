#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import type { Pool } from 'mysql2/promise';
import { dbConfig, env } from './config/env';
import { loadMappingFile, pickTarget } from './config/load';
import { createAdapter, createPool, detectDialect, ping } from './db/client';
import {
  createJobLogTables,
  getColumns,
  getPrimaryKeys,
  listJobLogs,
  listTables,
  tableExists,
  writeJobErrors,
  writeJobLog,
} from './db/introspect';
import { runSyncJob, summarize } from './core/job';
import { buildCreateTableSql } from './core/upsert';
import { validateRows } from './core/validate';
import { readSheet, detectHeaderRow } from './excel/reader';
import { generateTemplate } from './excel/template';
import { logger, setLogLevel } from './utils/logger';
import type { DbAdapter, UpsertDialect } from './core/types';

setLogLevel(env.LOG_LEVEL);

const program = new Command();

program
  .name('syncdb')
  .description('ระบบนำเข้าข้อมูลจากไฟล์ Excel Template เข้าฐานข้อมูล MySQL')
  .version('1.0.0');

interface DbContext {
  pool: Pool;
  db: DbAdapter;
  dialect: UpsertDialect;
}

async function withDb<T>(fn: (ctx: DbContext) => Promise<T>): Promise<T> {
  const pool = createPool(dbConfig());
  try {
    const dialect = await detectDialect(pool);
    const db = createAdapter(pool);
    try {
      return await fn({ pool, db, dialect });
    } finally {
      await db.end();
    }
  } finally {
    await pool.end();
  }
}

program
  .command('check')
  .description('ตรวจสอบการเชื่อมต่อ MySQL')
  .action(async () => {
    const cfg = dbConfig();
    await withDb(async ({ pool, db }) => {
      const result = await ping(pool);
      if (!result.ok) {
        logger.error('เชื่อมต่อ MySQL ไม่สำเร็จ', result.server);
        process.exitCode = 1;
        return;
      }
      logger.info('เชื่อมต่อ MySQL สำเร็จ', {
        server: result.server,
        version: result.version,
        database: cfg.database,
        user: cfg.user,
      });
      if (env.CREATE_JOB_LOG_TABLE) {
        await createJobLogTables(db);
        logger.info('ตรวจสอบตารางประวัติการทำงาน (sync_job_log) พร้อมใช้งาน');
      }
    });
  });

program
  .command('tables')
  .description('แสดงรายชื่อตารางในฐานข้อมูล')
  .option('--search <keyword>', 'กรองตามชื่อตาราง')
  .action(async (options: { search?: string }) => {
    await withDb(async ({ db }) => {
      const cfg = dbConfig();
      const tables = await listTables(db, cfg.database);
      const filtered = options.search
        ? tables.filter((t) => t.name.toLowerCase().includes(options.search!.toLowerCase()))
        : tables;
      console.log(`ตารางในฐานข้อมูล ${cfg.database} (${filtered.length} ตาราง):`);
      for (const t of filtered) {
        console.log(`  ${t.name.padEnd(34)} ${String(t.columns).padStart(3)} คอลัมน์  ${t.comment ?? ''}`);
      }
    });
  });

program
  .command('schema')
  .argument('<table>', 'ชื่อตาราง')
  .description('แสดงโครงสร้างคอลัมน์ของตาราง')
  .action(async (table: string) => {
    await withDb(async ({ db }) => {
      const cfg = dbConfig();
      const columns = await getColumns(db, table, cfg.database);
      if (columns.length === 0) {
        logger.error(`ไม่พบตาราง "${table}" ในฐานข้อมูล ${cfg.database}`);
        process.exitCode = 1;
        return;
      }
      const pks = await getPrimaryKeys(db, table, cfg.database);
      console.log(`โครงสร้างตาราง ${table}:`);
      console.log('  ' + 'คอลัมน์'.padEnd(30) + 'ชนิด'.padEnd(18) + 'NULL'.padEnd(7) + 'KEY'.padEnd(8) + 'ค่าเริ่มต้น');
      for (const c of columns) {
        console.log(
          '  ' +
            c.name.padEnd(30) +
            c.columnType.padEnd(18) +
            (c.isNullable ? 'YES'.padEnd(7) : 'NO'.padEnd(7)) +
            (c.columnKey ? c.columnKey.padEnd(8) : ''.padEnd(8)) +
            (c.defaultValue ?? ''),
        );
      }
      if (pks.length > 0) console.log(`  Primary Key: ${pks.join(', ')}`);
    });
  });

program
  .command('template')
  .argument('<config>', 'ไฟล์ mapping (.yaml/.json)')
  .argument('[outFile]', 'ไฟล์ Excel ที่จะสร้าง', 'template.xlsx')
  .option('-t, --target <name>', 'ชื่อ target ในไฟล์ mapping')
  .description('สร้างไฟล์ Excel template จาก mapping')
  .action(async (configFile: string, outFile: string, options: { target?: string }) => {
    const config = await loadMappingFile(configFile);
    const target = pickTarget(config, options.target);
    await generateTemplate(target, path.resolve(outFile));
    console.log(`สร้างไฟล์ template แล้ว: ${path.resolve(outFile)}`);
  });

program
  .command('validate')
  .argument('<file>', 'ไฟล์ Excel')
  .requiredOption('-c, --config <path>', 'ไฟล์ mapping (.yaml/.json)')
  .option('-t, --target <name>', 'ชื่อ target ในไฟล์ mapping')
  .description('ตรวจสอบข้อมูลในไฟล์ Excel โดยไม่บันทึกลงฐานข้อมูล')
  .action(async (file: string, options: { config: string; target?: string }) => {
    const config = await loadMappingFile(options.config);
    const target = pickTarget(config, options.target);
    const data = await readSheet(path.resolve(file), {
      sheet: target.sheet,
      headerRow: target.headerRow,
      startRow: target.startRow,
    });
    const result = validateRows(data.headers, data.rows, target);

    console.log(`ไฟล์: ${file}`);
    console.log(`Sheet: ${data.sheet} | หัวตารางแถวที่ ${target.headerRow} | ข้อมูล ${result.totalRows} แถว`);
    console.log(`ผ่าน ${result.validRows} แถว | ผิดพลาด ${result.invalidRows} แถว`);
    if (result.issues.length > 0) {
      console.log('\nรายละเอียดข้อผิดพลาด:');
      for (const issue of result.issues.slice(0, 50)) {
        console.log(`  แถว ${issue.row}${issue.column ? ` [${issue.column}]` : ''}: ${issue.message}`);
      }
      if (result.issues.length > 50) console.log(`  ... และอีก ${result.issues.length - 50} รายการ`);
    }
    if (result.invalidRows > 0) process.exitCode = 2;
  });

program
  .command('sync')
  .argument('<file>', 'ไฟล์ Excel')
  .requiredOption('-c, --config <path>', 'ไฟล์ mapping (.yaml/.json)')
  .option('-t, --target <name>', 'ชื่อ target ในไฟล์ mapping')
  .option('--on-error <mode>', 'skip หรือ abort', env.SYNC_ON_ERROR)
  .option('--batch-size <n>', 'จำนวนแถวต่อคำสั่ง INSERT', String(env.SYNC_BATCH_SIZE))
  .option('--dry-run', 'ตรวจสอบอย่างเดียว ไม่เขียนลงฐานข้อมูล')
  .description('นำเข้าข้อมูลจากไฟล์ Excel เข้าฐานข้อมูล MySQL (upsert)')
  .action(
    async (
      file: string,
      options: { config: string; target?: string; onError: string; batchSize: string; dryRun?: boolean },
    ) => {
      const config = await loadMappingFile(options.config);
      const target = pickTarget(config, options.target);
      const filePath = path.resolve(file);

      if (!fs.existsSync(filePath)) {
        logger.error(`ไม่พบไฟล์: ${filePath}`);
        process.exitCode = 1;
        return;
      }

      const onError = options.onError === 'abort' ? 'abort' : 'skip';
      const batchSize = Number(options.batchSize) || 1;

      await withDb(async ({ db, dialect }) => {
        const exists = await tableExists(db, target.table, dbConfig().database);
        if (!exists) {
          logger.warn(`ไม่พบตาราง "${target.table}" — สร้างให้อัตโนมัติ`, { table: target.table });
          await db.query(buildCreateTableSql(target));
        }

        const result = await runSyncJob({
          db,
          filePath,
          fileName: path.basename(filePath),
          target,
          dialect,
          onError,
          batchSize,
          jobName: target.name,
        });

        if (options.dryRun) {
          console.log('--- DRY RUN (ไม่ได้เขียนลงฐานข้อมูล) ---');
        }
        console.log(summarize(result));
        if (result.issues.length > 0) {
          console.log('\nข้อผิดพลาด:');
          for (const issue of result.issues.slice(0, 30)) {
            console.log(`  แถว ${issue.row}${issue.column ? ` [${issue.column}]` : ''}: ${issue.message}`);
          }
          if (result.issues.length > 30) console.log(`  ... และอีก ${result.issues.length - 30} รายการ`);
        }

        if (!options.dryRun && env.CREATE_JOB_LOG_TABLE) {
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
        }

        if (result.status === 'failed') process.exitCode = 3;
      });
    },
  );

program
  .command('ddl')
  .requiredOption('-c, --config <path>', 'ไฟล์ mapping (.yaml/.json)')
  .option('-t, --target <name>', 'ชื่อ target ในไฟล์ mapping')
  .option('--apply', 'สร้างตารางจริงในฐานข้อมูล (ค่าเริ่มต้นคือแค่แสดงคำสั่ง)')
  .description('สร้างคำสั่ง CREATE TABLE จาก mapping')
  .action(async (options: { config: string; target?: string; apply?: boolean }) => {
    const config = await loadMappingFile(options.config);
    const target = pickTarget(config, options.target);
    const sql = buildCreateTableSql(target);

    if (!options.apply) {
      console.log(sql);
      console.log('\n(ใช้ --apply เพื่อสร้างตารางจริง)');
      return;
    }

    await withDb(async ({ db }) => {
      await db.query(sql);
      logger.info('สร้างตารางเรียบร้อย', { table: target.table });
    });
  });

program
  .command('jobs')
  .option('-n, --limit <n>', 'จำนวนรายการ', '20')
  .description('แสดงประวัติการนำเข้าข้อมูลล่าสุด')
  .action(async (options: { limit: string }) => {
    await withDb(async ({ db }) => {
      if (env.CREATE_JOB_LOG_TABLE) await createJobLogTables(db);
      const logs = await listJobLogs(db, Number(options.limit) || 20);
      if (logs.length === 0) {
        console.log('ยังไม่มีประวัติการนำเข้าข้อมูล');
        return;
      }
      console.log('เวลา'.padEnd(22) + 'สถานะ'.padEnd(10) + 'ตาราง'.padEnd(22) + 'ทั้งหมด'.padEnd(10) + 'เพิ่ม'.padEnd(8) + 'อัปเดต'.padEnd(8) + 'ผิดพลาด');
      for (const log of logs) {
        console.log(
          String(log.createdAt).padEnd(22) +
            log.status.padEnd(10) +
            String(log.targetTable ?? '').padEnd(22) +
            String(log.totalRows).padEnd(10) +
            String(log.insertedRows).padEnd(8) +
            String(log.updatedRows).padEnd(8) +
            String(log.failedRows),
        );
      }
    });
  });

program
  .command('serve')
  .option('-p, --port <port>', 'พอร์ต', String(env.APP_PORT))
  .option('--host <host>', 'host', env.APP_HOST)
  .description('เปิด Web UI สำหรับอัปโหลดไฟล์และตั้งค่า mapping')
  .action(async (options: { port: string; host: string }) => {
    const { startServer } = await import('./server');
    await startServer(Number(options.port) || env.APP_PORT, options.host);
  });

program
  .command('header-row')
  .argument('<file>', 'ไฟล์ Excel')
  .option('-s, --sheet <name>', 'ชื่อ sheet')
  .description('ตรวจจับแถวหัวตารางของไฟล์ Excel')
  .action(async (file: string, options: { sheet?: string }) => {
    const row = await detectHeaderRow(path.resolve(file), options.sheet);
    console.log(`แถวหัวตารางที่คาดว่าเป็น: ${row}`);
  });

program.parseAsync(process.argv).catch((err: Error) => {
  logger.error(err.message);
  process.exit(1);
});
