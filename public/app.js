/* SyncDBJOB — Web UI (ไม่ต้อง build) */
'use strict';

const state = {
  fileId: null,
  fileName: '',
  sheets: [],
  sheet: null,
  headerRow: 1,
  headers: [],
  previewRows: [],
  tables: [],
  dbColumns: [],
  primaryKeys: [],
  mapping: [],
  targetTable: '',
  mappingId: null,
  user: null,
  isAdmin: true,
};

const TYPES = ['string', 'int', 'bigint', 'decimal', 'float', 'bool', 'date', 'datetime', 'timestamp', 'json'];

const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function redirectToLogin() {
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, { credentials: 'same-origin', ...options });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (res.status === 401 && data.authRequired) {
    redirectToLogin();
    throw new Error(data.error || 'กรุณาเข้าสู่ระบบ');
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

/* ---------------- ผู้ใช้ที่ล็อกอิน ---------------- */
async function loadMe() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (res.status === 401) {
      redirectToLogin();
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    if (data.authEnabled === false) return;
    state.user = data.user || null;
    state.isAdmin = String(state.user?.role || '').toUpperCase() === 'ADMIN';
    const box = $('userBox');
    if (state.user) {
      box.hidden = false;
      $('userInfo').textContent = `${state.user.fullName || state.user.username} (${state.user.role})`;
    }
  } catch {
    /* ยังเข้าไม่ได้ — ปล่อยให้หน้าโหลดตามปกติ */
  }
}

$('btnLogout').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    /* ไม่เป็นไร */
  }
  window.location.href = '/login';
});

let toastTimer = null;
function toast(message, kind = '') {
  const el = $('toast');
  el.textContent = message;
  el.className = 'toast ' + kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 5000);
}

/* ---------------- Tabs ---------------- */
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('main section').forEach((s) => (s.hidden = true));
    $('tab-' + btn.dataset.tab).hidden = false;
    if (btn.dataset.tab === 'mappings') loadMappings();
    if (btn.dataset.tab === 'jobs') loadJobs();
    if (btn.dataset.tab === 'tables') loadTables();
  });
});

/* ---------------- สถานะการเชื่อมต่อ ---------------- */
async function loadHealth() {
  const el = $('connInfo');
  try {
    const data = await api('/health');
    if (data.connected) {
      el.className = 'conn ok';
      el.textContent = `${data.database} · MySQL ${data.version} · ${data.server}`;
    } else {
      el.className = 'conn err';
      el.textContent = `เชื่อมต่อไม่สำเร็จ: ${data.server}`;
    }
  } catch (err) {
    el.className = 'conn err';
    el.textContent = 'เชื่อมต่อไม่สำเร็จ: ' + err.message;
  }
}

/* ---------------- อัปโหลดไฟล์ ---------------- */
const dropzone = $('dropzone');
const fileInput = $('fileInput');
dropzone.addEventListener('click', () => fileInput.click());
['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  }),
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
  }),
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) uploadFile(fileInput.files[0]);
});

async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  try {
    toast('กำลังอัปโหลดไฟล์…');
    const data = await api('/upload', { method: 'POST', body: form });
    state.fileId = data.fileId;
    state.fileName = data.fileName;
    state.sheets = data.sheets;
    state.sheet = data.sheets[0] ? data.sheets[0].name : null;
    state.headerRow = data.detectedHeaderRow || 1;

    $('fileMeta').hidden = false;
    $('fileName').value = data.fileName;
    const sel = $('sheetSelect');
    sel.innerHTML = state.sheets
      .map((s) => `<option value="${esc(s.name)}">${esc(s.name)} (${s.rowCount} แถว)</option>`)
      .join('');
    sel.value = state.sheet || '';
    $('headerRow').value = state.headerRow;
    $('btnPreview').disabled = false;
    toast(`อัปโหลดสำเร็จ: ${data.fileName}`, 'ok');
    await loadPreview();
  } catch (err) {
    toast('อัปโหลดไม่สำเร็จ: ' + err.message, 'err');
  }
}

$('sheetSelect').addEventListener('change', (e) => {
  state.sheet = e.target.value;
});
$('headerRow').addEventListener('change', (e) => {
  state.headerRow = Number(e.target.value) || 1;
});
$('btnPreview').addEventListener('click', loadPreview);

async function loadPreview() {
  if (!state.fileId) return;
  try {
    const data = await api('/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: state.fileId, sheet: state.sheet, headerRow: state.headerRow, limit: 20 }),
    });
    state.headers = data.headers;
    state.previewRows = data.rows;
    renderPreview();
    $('previewWrap').hidden = false;
    if (state.mapping.length === 0) buildMappingRows();
  } catch (err) {
    toast('ดูตัวอย่างข้อมูลไม่สำเร็จ: ' + err.message, 'err');
  }
}

function renderPreview() {
  const table = $('previewTable');
  const head = `<thead><tr>${state.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`;
  const body = state.previewRows
    .map((r) => `<tr>${r.cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('');
  table.innerHTML = head + `<tbody>${body}</tbody>`;
}

/* ---------------- ตารางปลายทาง ---------------- */
async function loadTables() {
  try {
    const data = await api('/tables');
    state.tables = data.tables;
    const sel = $('targetTable');
    const current = sel.value;
    sel.innerHTML = '<option value="">— เลือกตาราง —</option>' +
      state.tables.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('');
    if (current) sel.value = current;

    $('tablesTable').innerHTML =
      '<thead><tr><th>ชื่อตาราง</th><th>ประเภท</th><th>จำนวนคอลัมน์</th><th>ประมาณจำนวนแถว</th><th>คอมเมนต์</th></tr></thead><tbody>' +
      state.tables
        .map(
          (t) =>
            `<tr><td>${esc(t.name)}</td><td>${esc(t.type)}</td><td>${t.columns}</td><td>${t.rows}</td><td>${esc(t.comment || '')}</td></tr>`,
        )
        .join('') +
      '</tbody>';
  } catch (err) {
    toast('โหลดรายชื่อตารางไม่สำเร็จ: ' + err.message, 'err');
  }
}

$('targetTable').addEventListener('change', (e) => {
  state.targetTable = e.target.value;
  $('btnLoadSchema').disabled = !state.targetTable;
  $('btnCreateTable').disabled = true;
  $('btnTemplate').disabled = true;
});

$('btnLoadSchema').addEventListener('click', loadSchema);

async function loadSchema() {
  if (!state.targetTable) return;
  try {
    const data = await api(`/tables/${encodeURIComponent(state.targetTable)}/schema`);
    state.dbColumns = data.columns;
    state.primaryKeys = data.primaryKeys || [];

    const body = {
      headers: state.headers,
      columns: state.dbColumns.map((c) => ({ name: c.name, dataType: c.dataType })),
    };
    const res = await api('/auto-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const suggestions = res.suggestions;
    state.mapping = state.headers.map((h, i) => {
      const s = suggestions[i] || { excel: h, db: '', type: 'string', matched: false };
      const pk = state.primaryKeys.includes(s.db);
      return {
        use: true,
        excel: h,
        db: s.db || '',
        type: s.matched ? s.type : 'string',
        required: pk,
        isKey: pk,
        enumText: '',
        maxLength: '',
        constant: '',
      };
    });
    renderMapping();
    toast(`จับคู่อัตโนมัติแล้ว ${state.mapping.filter((m) => m.db).length}/${state.mapping.length} คอลัมน์`, 'ok');
  } catch (err) {
    toast('ดึงโครงสร้างตารางไม่สำเร็จ: ' + err.message, 'err');
  }
}

/* ---------------- ตารางจับคู่คอลัมน์ ---------------- */
function buildMappingRows() {
  state.mapping = state.headers.map((h) => ({
    use: true,
    excel: h,
    db: '',
    type: 'string',
    required: false,
    isKey: false,
    enumText: '',
    maxLength: '',
    constant: '',
  }));
  renderMapping();
}

function renderMapping() {
  const body = $('mapBody');
  if (state.mapping.length === 0) {
    body.innerHTML = '<tr><td colspan="8" class="muted">ยังไม่มีข้อมูล — อัปโหลดไฟล์ Excel ก่อน</td></tr>';
    $('btnValidate').disabled = true;
    $('btnDryRun').disabled = true;
    $('btnSync').disabled = true;
    $('btnSave').disabled = true;
    $('btnCreateTable').disabled = true;
    $('btnTemplate').disabled = true;
    return;
  }

  body.innerHTML = state.mapping
    .map((m, i) => {
      const excelOptions = ['<option value="">(ไม่ใช้จาก Excel)</option>']
        .concat(state.headers.map((h) => `<option value="${esc(h)}"${h === m.excel ? ' selected' : ''}>${esc(h)}</option>`))
        .join('');
      const dbOptions = ['<option value="">(เลือกคอลัมน์…)</option>']
        .concat(state.dbColumns.map((c) => `<option value="${esc(c.name)}"${c.name === m.db ? ' selected' : ''}>${esc(c.name)} (${esc(c.dataType)})</option>`))
        .join('');
      const typeOptions = TYPES.map((t) => `<option value="${t}"${t === m.type ? ' selected' : ''}>${t}</option>`).join('');
      return `<tr data-i="${i}">
        <td><input type="checkbox" class="m-use" ${m.use ? 'checked' : ''}></td>
        <td><select class="m-excel">${excelOptions}</select></td>
        <td><select class="m-db">${dbOptions}</select></td>
        <td><select class="m-type">${typeOptions}</select></td>
        <td><input type="checkbox" class="m-required" ${m.required ? 'checked' : ''}></td>
        <td><input type="checkbox" class="m-key" ${m.isKey ? 'checked' : ''}></td>
        <td><input type="text" class="m-enum" value="${esc(m.enumText)}" placeholder="เช่น ก,ข"></td>
        <td><input type="text" class="m-max" value="${esc(m.maxLength)}" placeholder="255"></td>
      </tr>`;
    })
    .join('');

  body.querySelectorAll('tr[data-i]').forEach((tr) => {
    const i = Number(tr.dataset.i);
    const m = state.mapping[i];
    tr.querySelector('.m-use').addEventListener('change', (e) => (m.use = e.target.checked));
    tr.querySelector('.m-excel').addEventListener('change', (e) => (m.excel = e.target.value));
    tr.querySelector('.m-db').addEventListener('change', (e) => (m.db = e.target.value));
    tr.querySelector('.m-type').addEventListener('change', (e) => (m.type = e.target.value));
    tr.querySelector('.m-required').addEventListener('change', (e) => (m.required = e.target.checked));
    tr.querySelector('.m-key').addEventListener('change', (e) => (m.isKey = e.target.checked));
    tr.querySelector('.m-enum').addEventListener('input', (e) => (m.enumText = e.target.value));
    tr.querySelector('.m-max').addEventListener('input', (e) => (m.maxLength = e.target.value));
  });

  const ready = state.mapping.some((m) => m.use && m.db);
  $('btnValidate').disabled = !ready;
  $('btnDryRun').disabled = !ready;
  $('btnSync').disabled = !ready;
  $('btnSave').disabled = !ready;
  $('btnCreateTable').disabled = !ready;
  $('btnTemplate').disabled = !ready;
}

function collectConfig() {
  const columns = state.mapping
    .filter((m) => m.use && m.db)
    .map((m) => {
      const col = {
        excel: m.excel || '',
        db: m.db,
        type: m.type,
        required: !!m.required,
        isKey: !!m.isKey,
      };
      const enumValues = (m.enumText || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (enumValues.length) col.enum = enumValues;
      if (m.maxLength) col.maxLength = Number(m.maxLength);
      return col;
    });

  const mode = $('syncMode').value;
  const keys = state.mapping.filter((m) => m.use && m.isKey && m.db).map((m) => m.db);
  const name = $('mappingName').value.trim() || state.targetTable || 'target';

  return {
    version: 1,
    name,
    targets: [
      {
        name,
        table: state.targetTable,
        mode,
        keys: mode === 'upsert' ? keys : [],
        sheet: state.sheet || undefined,
        headerRow: state.headerRow,
        startRow: state.headerRow + 1,
        columns,
      },
    ],
  };
}

/* ---------------- ตรวจสอบ / นำเข้า ---------------- */
$('btnValidate').addEventListener('click', async () => {
  if (!state.fileId) return;
  try {
    const data = await api('/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: state.fileId, config: collectConfig() }),
    });
    const box = $('resultBox');
    box.hidden = false;
    box.className = 'result ' + (data.invalidRows > 0 ? 'partial' : 'success');
    const issues = data.issues
      .map((i) => `<li>แถว ${i.row}${i.column ? ' [' + esc(i.column) + ']' : ''}: ${esc(i.message)}</li>`)
      .join('');
    box.innerHTML = `<h4>ผลการตรวจสอบ</h4>
      <div class="stat-row">
        <div class="stat"><b>${data.totalRows}</b><span>แถวทั้งหมด</span></div>
        <div class="stat"><b>${data.validRows}</b><span>ผ่าน</span></div>
        <div class="stat"><b>${data.invalidRows}</b><span>ผิดพลาด</span></div>
      </div>
      ${issues ? '<ul>' + issues + '</ul>' : '<p class="muted">ไม่พบข้อผิดพลาด</p>'}`;
  } catch (err) {
    toast('ตรวจสอบไม่สำเร็จ: ' + err.message, 'err');
  }
});

$('btnSync').addEventListener('click', async () => {
  if (!state.fileId) return;
  if (!confirm('ยืนยันการนำเข้าข้อมูลเข้าฐานข้อมูล?')) return;
  const btn = $('btnSync');
  btn.disabled = true;
  btn.textContent = 'กำลังนำเข้า…';
  try {
    const data = await api('/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: state.fileId, config: collectConfig() }),
    });
    renderResult(data.result);
    toast('นำเข้าข้อมูลเสร็จสิ้น: ' + data.result.status, data.result.status === 'failed' ? 'err' : 'ok');
  } catch (err) {
    toast('นำเข้าข้อมูลไม่สำเร็จ: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'นำเข้าข้อมูลเข้า MySQL';
  }
});

$('btnDryRun').addEventListener('click', async () => {
  if (!state.fileId) return;
  const btn = $('btnDryRun');
  btn.disabled = true;
  btn.textContent = 'กำลังทดลอง…';
  try {
    const data = await api('/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: state.fileId, config: collectConfig(), dryRun: true }),
    });
    renderResult(data.result);
    toast(
      'ทดลองเสร็จแล้ว (ไม่ได้เขียนลงฐานข้อมูล): จะเพิ่มใหม่ ' +
        data.result.inserted +
        ' แถว, อัปเดต ' +
        data.result.updated +
        ' แถว',
      'ok',
    );
  } catch (err) {
    toast('ทดลองไม่สำเร็จ: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'ทดลองนำเข้า (ไม่เขียน DB)';
  }
});

function renderResult(result) {
  const box = $('resultBox');
  box.hidden = false;
  box.className = 'result ' + result.status;
  const issues = (result.issues || [])
    .slice(0, 50)
    .map((i) => `<li>แถว ${i.row}${i.column ? ' [' + esc(i.column) + ']' : ''}: ${esc(i.message)}</li>`)
    .join('');
  box.innerHTML = `<h4>ผลการนำเข้าข้อมูล — ${esc(result.status)}</h4>
    <div class="stat-row">
      <div class="stat"><b>${result.totalRows}</b><span>แถวทั้งหมด</span></div>
      <div class="stat"><b>${result.inserted}</b><span>เพิ่มใหม่</span></div>
      <div class="stat"><b>${result.updated}</b><span>อัปเดต</span></div>
      <div class="stat"><b>${result.unchanged}</b><span>ไม่เปลี่ยน</span></div>
      <div class="stat"><b>${result.failed}</b><span>ผิดพลาด</span></div>
      <div class="stat"><b>${result.durationMs}</b><span>มิลลิวินาที</span></div>
    </div>
    <p class="muted">ตาราง ${esc(result.table)} · ไฟล์ ${esc(result.fileName)} · sheet ${esc(result.sheet)}</p>
    ${issues ? '<ul>' + issues + '</ul>' : ''}`;
}

/* ---------------- สร้างตาราง / template / บันทึก ---------------- */
$('btnCreateTable').addEventListener('click', async () => {
  try {
    const data = await api('/ddl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: collectConfig(), apply: true }),
    });
    const out = $('ddlOut');
    out.hidden = false;
    out.textContent = data.sql;
    toast('สร้างตารางสำเร็จ: ' + state.targetTable, 'ok');
  } catch (err) {
    toast('สร้างตารางไม่สำเร็จ: ' + err.message, 'err');
  }
});

$('btnTemplate').addEventListener('click', async () => {
  try {
    const data = await api('/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: collectConfig(), outFile: `template_${state.targetTable}.xlsx` }),
    });
    toast('สร้างไฟล์ template แล้ว: ' + data.file, 'ok');
  } catch (err) {
    toast('สร้าง template ไม่สำเร็จ: ' + err.message, 'err');
  }
});

$('btnSave').addEventListener('click', async () => {
  try {
    const data = await api('/mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('mappingName').value.trim() || state.targetTable, config: collectConfig() }),
    });
    state.mappingId = data.mapping.id;
    toast('บันทึกการตั้งค่าเรียบร้อย', 'ok');
  } catch (err) {
    toast('บันทึกไม่สำเร็จ: ' + err.message, 'err');
  }
});

/* ---------------- การตั้งค่าที่บันทึกไว้ ---------------- */
async function loadMappings() {
  try {
    const data = await api('/mappings');
    $('mappingsTable').innerHTML =
      '<thead><tr><th>ชื่อ</th><th>รายละเอียด</th><th>อัปเดตล่าสุด</th><th>จัดการ</th></tr></thead><tbody>' +
      (data.mappings.length
        ? data.mappings
            .map(
              (m) => `<tr>
                <td>${esc(m.name)}</td>
                <td>${esc(m.summary)}</td>
                <td>${esc(m.updatedAt)}</td>
                <td>
                  <button class="btn btn-ghost" data-load="${esc(m.id)}">ใช้งาน</button>
                  ${state.isAdmin ? `<button class="btn btn-danger" data-del="${esc(m.id)}">ลบ</button>` : ''}
                </td></tr>`,
            )
            .join('')
        : '<tr><td colspan="4" class="muted">ยังไม่มีการตั้งค่า</td></tr>') +
      '</tbody>';

    $('mappingsTable')
      .querySelectorAll('[data-load]')
      .forEach((btn) => btn.addEventListener('click', () => useMapping(btn.dataset.load)));
    $('mappingsTable')
      .querySelectorAll('[data-del]')
      .forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('ลบการตั้งค่านี้?')) return;
          await api('/mappings/' + btn.dataset.del, { method: 'DELETE' });
          loadMappings();
        }),
      );
  } catch (err) {
    toast('โหลดการตั้งค่าไม่สำเร็จ: ' + err.message, 'err');
  }
}

$('btnReloadMappings').addEventListener('click', loadMappings);

async function useMapping(id) {
  try {
    const data = await api('/mappings/' + id);
    const cfg = data.mapping.config;
    const target = cfg.targets[0];
    state.mappingId = id;
    state.targetTable = target.table;
    state.mapping = target.columns.map((c) => ({
      use: true,
      excel: c.excel || '',
      db: c.db,
      type: c.type,
      required: !!c.required,
      isKey: !!c.isKey || target.keys.includes(c.db),
      enumText: (c.enum || []).join(','),
      maxLength: c.maxLength || '',
      constant: '',
    }));
    $('mappingName').value = data.mapping.name;
    $('syncMode').value = target.mode || 'upsert';
    $('headerRow').value = target.headerRow || 1;
    if (target.sheet) {
      state.sheet = target.sheet;
      $('sheetSelect').value = target.sheet;
    }
    $('targetTable').value = state.targetTable;
    $('btnLoadSchema').disabled = false;
    $('btnCreateTable').disabled = false;
    $('btnTemplate').disabled = false;
    await loadSchema();
    // คืนค่าการจับคู่จากไฟล์ที่บันทึกไว้
    state.mapping = target.columns.map((c) => ({
      use: true,
      excel: c.excel || '',
      db: c.db,
      type: c.type,
      required: !!c.required,
      isKey: !!c.isKey || target.keys.includes(c.db),
      enumText: (c.enum || []).join(','),
      maxLength: c.maxLength || '',
      constant: '',
    }));
    renderMapping();
    document.querySelector('.tab[data-tab="import"]').click();
    toast('โหลดการตั้งค่า "' + data.mapping.name + '" แล้ว', 'ok');
  } catch (err) {
    toast('โหลดการตั้งค่าไม่สำเร็จ: ' + err.message, 'err');
  }
}

/* ---------------- ประวัติ ---------------- */
async function loadJobs() {
  try {
    const data = await api('/jobs');
    $('jobsTable').innerHTML =
      '<thead><tr><th>เวลา</th><th>สถานะ</th><th>ตาราง</th><th>ไฟล์</th><th>ทั้งหมด</th><th>เพิ่ม</th><th>อัปเดต</th><th>ผิดพลาด</th><th>ใช้เวลา</th><th>ข้อผิดพลาด</th></tr></thead><tbody>' +
      (data.jobs.length
        ? data.jobs
            .map(
              (j) => `<tr>
                <td>${esc(j.createdAt)}</td>
                <td>${esc(j.status)}</td>
                <td>${esc(j.targetTable || '')}</td>
                <td>${esc(j.fileName || '')}</td>
                <td>${j.totalRows}</td>
                <td>${j.insertedRows}</td>
                <td>${j.updatedRows}</td>
                <td>${j.failedRows}</td>
                <td>${j.durationMs} ms</td>
                <td><button class="btn btn-ghost" data-err="${esc(j.jobId)}">ดู</button></td>
              </tr>`,
            )
            .join('')
        : '<tr><td colspan="10" class="muted">ยังไม่มีประวัติ</td></tr>') +
      '</tbody>';

    $('jobsTable')
      .querySelectorAll('[data-err]')
      .forEach((btn) =>
        btn.addEventListener('click', async () => {
          const data = await api('/jobs/' + btn.dataset.err + '/errors');
          const list = data.errors
            .map((e) => `<li>แถว ${e.row_number ?? '-'}${e.column_name ? ' [' + esc(e.column_name) + ']' : ''}: ${esc(e.message)}</li>`)
            .join('');
          toast(list ? 'ข้อผิดพลาด: ' + list.replace(/<[^>]+>/g, ' ').slice(0, 300) : 'ไม่มีข้อผิดพลาด');
        }),
      );
  } catch (err) {
    toast('โหลดประวัติไม่สำเร็จ: ' + err.message, 'err');
  }
}

$('btnReloadJobs').addEventListener('click', loadJobs);
$('btnReloadTables').addEventListener('click', loadTables);

/* ---------------- เริ่มต้น ---------------- */
loadMe();
loadHealth();
loadTables();
