import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { exportsDir, resolveExportPath, storageRoot } from '../src/store/mappings';

describe('resolveExportPath', () => {
  it('บังคับให้อยู่ในโฟลเดอร์ storage/exports เสมอ', () => {
    const result = resolveExportPath('template_customers.xlsx');
    expect(path.dirname(result)).toBe(exportsDir);
    expect(path.basename(result)).toBe('template_customers.xlsx');
  });

  it('กัน path traversal (เขียนไฟล์นอก storage/exports ไม่ได้)', () => {
    const evil = [
      '../../etc/passwd',
      '../../../etc/nginx/nginx.conf',
      '..\\..\\windows\\system32\\config\\sam',
      '/etc/passwd',
      'C:\\Windows\\System32\\drivers\\etc\\hosts',
    ];

    for (const name of evil) {
      const result = resolveExportPath(name);
      expect(path.dirname(result)).toBe(exportsDir);
      expect(path.resolve(result).startsWith(path.resolve(storageRoot))).toBe(true);
    }
  });

  it('ตัดอักขระแปลก ๆ ออกจากชื่อไฟล์', () => {
    const result = resolveExportPath('my file;rm -rf.xlsx');
    expect(path.basename(result)).toBe('my file_rm -rf.xlsx');
  });

  it('ชื่อว่างใช้ค่าเริ่มต้นแทน', () => {
    expect(path.basename(resolveExportPath(''))).toBe('template.xlsx');
    expect(path.basename(resolveExportPath('   '))).toBe('template.xlsx');
    expect(path.basename(resolveExportPath('...'))).toBe('template.xlsx');
  });
});
