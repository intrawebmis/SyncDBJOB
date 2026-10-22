// ตรวจสอบว่า syntax แบบไหนใช้ได้กับเซิร์ฟเวอร์จริง (MariaDB vs MySQL)
import 'dotenv/config';
import mysql from 'mysql2/promise';

const cfg = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const conn = await mysql.createConnection(cfg);
const [vrows] = await conn.query('SELECT VERSION() AS v');
console.log('VERSION() =', vrows[0].v);

const [rows] = await conn.query('SHOW CREATE TABLE `sync_job_log`');
console.log('\nSHOW CREATE TABLE sync_job_log:\n', rows[0]['Create Table']);

// ทดสอบ syntax แบบ alias (MySQL 8.0.19+)
try {
  await conn.query(
    'CREATE TEMPORARY TABLE `t_probe` (`k` VARCHAR(10) NOT NULL PRIMARY KEY, `v` INT NULL)',
  );
} catch (e) {
  console.log('สร้างตารางชั่วคราวไม่สำเร็จ:', e.message);
}

const statements = [
  ['alias (AS new)', 'INSERT INTO `t_probe` (`k`,`v`) VALUES (?,?) AS new ON DUPLICATE KEY UPDATE `v` = new.`v`'],
  ['VALUES()', 'INSERT INTO `t_probe` (`k`,`v`) VALUES (?,?) ON DUPLICATE KEY UPDATE `v` = VALUES(`v`)'],
];

for (const [label, sql] of statements) {
  try {
    await conn.query(sql, ['k1', 1]);
    await conn.query(sql, ['k1', 2]);
    const [r] = await conn.query('SELECT `v` FROM `t_probe` WHERE `k`=?', ['k1']);
    console.log(`  ✅ ${label} ใช้ได้ (ค่าล่าสุด = ${r[0].v})`);
  } catch (e) {
    console.log(`  ❌ ${label} ใช้ไม่ได้ → ${e.code || ''} ${e.message}`);
  }
}

await conn.query('DROP TEMPORARY TABLE IF EXISTS `t_probe`');
await conn.end();
