# SyncDBJOB — ระบบนำเข้าข้อมูลจากไฟล์ Excel Template เข้าฐานข้อมูล MySQL

ระบบ Transfer ข้อมูลจากไฟล์ Excel (Template) เข้าสู่ฐานข้อมูล MySQL แบบ **Upsert**
(เพิ่มใหม่ถ้าไม่มี / อัปเดตของเดิมถ้ามี) พร้อม Web UI สำหรับอัปโหลดไฟล์และกำหนดการจับคู่คอลัมน์แบบ visual

---

## 1. ความต้องการระบบ

| รายการ | รุ่น/รายละเอียด |
|---|---|
| Node.js | 18.18+ (ทดสอบด้วย v24) |
| MySQL | 5.7 / 8.0+ (เชื่อมต่อเป็น **Remote Server**) |
| ระบบปฏิบัติการ | Windows / Linux / macOS |

---

## 2. การติดตั้ง

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
# แก้ค่า DB_HOST, DB_USER, DB_PASSWORD, DB_NAME ในไฟล์ .env
```

ตรวจสอบการเชื่อมต่อ:

```bash
npm run dev -- check
```

---

## 3. การใช้งาน

### 3.1 แบบ Web UI (แนะนำ)

```bash
npm run serve            # เปิดที่ http://localhost:3000
```

ขั้นตอนในหน้าเว็บ

1. **อัปโหลดไฟล์ Excel** — ระบบอ่านชื่อ sheet, ตรวจจับแถวหัวตารางให้อัตโนมัติ และแสดงตัวอย่างข้อมูล
2. **เลือกตารางปลายทาง** — ดึงรายชื่อตารางจาก `information_schema` ของเซิร์ฟเวอร์จริง
3. **จับคู่คอลัมน์อัตโนมัติ** — เทียบชื่อหัวตารางกับชื่อคอลัมน์ใน DB
   (รองรับหัวตารางภาษาไทย เช่น `รหัสลูกค้า` → `customer_code`) แก้ไขได้ตามต้องการ
4. **ตรวจสอบข้อมูล (Validate)** — ยังไม่เขียนลง DB แสดงรายการแถวที่ผิดพลาดพร้อมเลขแถว
5. **นำเข้าข้อมูล** — เขียนลง MySQL พร้อมสรุปจำนวน เพิ่มใหม่ / อัปเดต / ไม่เปลี่ยน / ผิดพลาด
6. **บันทึกการตั้งค่า** — เก็บ mapping ไว้ใช้ซ้ำได้ (แท็บ "การตั้งค่า")

ปุ่มเสริม: สร้างตารางจาก mapping (DDL), สร้างไฟล์ Excel Template, ดูประวัติการทำงาน

### 3.2 แบบ Command Line

```bash
# ตรวจการเชื่อมต่อ
npm run dev -- check

# ดูรายชื่อตาราง / โครงสร้างตาราง
npm run dev -- tables
npm run dev -- schema customers

# สร้างไฟล์ Excel Template จาก mapping
npm run dev -- template config/example.mapping.yaml data/template.xlsx

# ตรวจสอบข้อมูลโดยไม่เขียนลงฐานข้อมูล (exit code 2 = มีแถวผิดพลาด)
npm run dev -- validate data/example-customers.xlsx -c config/example.mapping.yaml

# นำเข้าข้อมูลเข้า MySQL
npm run dev -- sync data/example-customers.xlsx -c config/example.mapping.yaml

# ดูคำสั่ง CREATE TABLE (เติม --apply เพื่อสร้างจริง)
npm run dev -- ddl -c config/example.mapping.yaml

# ประวัติการนำเข้าข้อมูลล่าสุด
npm run dev -- jobs
```

ตัวเลือกของ `sync`:

| ตัวเลือก | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `-t, --target <name>` | target แรก | เลือก target ในไฟล์ mapping |
| `--on-error <skip\|abort>` | `skip` | `abort` = ย้อนกลับทั้งหมดเมื่อพบข้อผิดพลาด |
| `--batch-size <n>` | `1` | รวมหลายแถวต่อคำสั่ง INSERT (เร็วขึ้นเมื่อไฟล์ใหญ่) |
| `--dry-run` | — | ตรวจสอบอย่างเดียว ไม่เขียนลง DB |

> เมื่อ `--batch-size > 1` และคำสั่งรวมแถวล้มเหลว ระบบจะ fallback ไปทำทีละแถวอัตโนมัติ
> เพื่อหาแถวที่มีปัญหาจริง ๆ โดยไม่ทำให้ทั้งชุดล้มเหลว

---

## 4. โครงสร้างไฟล์ Mapping

ไฟล์ mapping คือ "สัญญา" ระหว่างไฟล์ Excel กับตารางใน MySQL (รองรับ `.yaml` และ `.json`)
ดูตัวอย่างเต็มที่ [`config/example.mapping.yaml`](config/example.mapping.yaml)

```yaml
version: 1
name: ข้อมูลลูกค้า

targets:
  - name: customers            # ชื่อที่แสดงผล
    table: customers           # ชื่อตารางใน MySQL
    mode: upsert               # upsert | insert
    keys: [customer_code]      # คอลัมน์ key สำหรับ upsert (บังคับเมื่อ mode=upsert)
    sheet: ลูกค้า              # ชื่อ sheet (ไม่ระบุ = sheet แรก)
    headerRow: 1               # แถวหัวตาราง
    startRow: 2                # แถวข้อมูลแรก
    skipEmptyRows: true

    columns:
      - excel: รหัสลูกค้า      # ข้อความหัวตารางใน Excel (เทียบแบบไม่สนตัวพิมพ์)
        db: customer_code      # ชื่อคอลัมน์ใน MySQL
        type: string           # string|int|bigint|decimal|float|bool|date|datetime|timestamp|json
        required: true
        isKey: true
        maxLength: 20
```

### ตัวเลือกรายคอลัมน์

| ฟิลด์ | ความหมาย |
|---|---|
| `excel` | ข้อความหัวตารางใน Excel (เว้นว่างได้ถ้าใช้ `constant`) |
| `db` | ชื่อคอลัมน์ใน MySQL |
| `type` | ชนิดข้อมูล — ใช้ตรวจสอบและแปลงค่าก่อนเขียน |
| `required` | ต้องมีค่า ถ้าไม่มีจะข้ามแถวนั้นและบันทึกเป็นข้อผิดพลาด |
| `isKey` | ใช้เป็น key ของการ upsert (หรือใส่ชื่อคอลัมน์ใน `keys`) |
| `constant` | ค่าคงที่ที่ใส่ให้อัตโนมัติ เช่น `excel` หรือ `{{now}}` / `{{today}}` |
| `default` | ค่าที่ใช้เมื่อเซลล์ใน Excel ว่าง |
| `maxLength` | ความยาวสูงสุด (สำหรับ string) |
| `min` / `max` | ขอบเขตของค่าตัวเลข |
| `scale` | จำนวนทศนิยมของ `decimal` |
| `pattern` | regex สำหรับตรวจรูปแบบข้อความ |
| `enum` | รายการค่าที่อนุญาต เช่น `[active, inactive]` |
| `trim` | ตัดช่องว่างหัวท้าย (default `true`) |

### การแปลงค่าอัตโนมัติ

| ชนิด | รองรับ |
|---|---|
| `string` | ตัดช่องว่าง, ตรวจความยาว, regex, enum |
| `int` / `bigint` | รองรับเลขที่มีจุลภาค (`1,234`), ต้องเป็นจำนวนเต็ม |
| `decimal` / `float` | ปัดทศนิยมตาม `scale`, ตรวจขอบเขต |
| `bool` | `true/false`, `1/0`, `yes/no`, `ใช่/ไม่ใช่`, `จริง/เท็จ` |
| `date` | `Date`, ISO (`2024-01-31`), `31/01/2024`, เลข serial ของ Excel |
| `datetime` / `timestamp` | รองรับทั้งวันที่และเวลา → เก็บเป็น `YYYY-MM-DD HH:mm:ss` |
| `json` | parse และตรวจความถูกต้องก่อนเขียน |

---

## 5. ไฟล์ Excel Template

`npm run dev -- template <mapping> <ไฟล์ผลลัพธ์>` จะสร้างไฟล์ที่มี

- **Sheet ข้อมูล** — หัวตารางพร้อมรูปแบบตัวเลข/วันที่ และ Data Validation (dropdown) สำหรับคอลัมน์ที่กำหนด `enum`
- **Sheet "คำแนะนำ"** — อธิบายแต่ละคอลัมน์ (หัวตาราง, คอลัมน์ DB, ชนิดข้อมูล, บังคับ, ค่าที่อนุญาต, ตัวอย่าง)
- **Sheet "ตัวอย่างข้อมูล"** — ตัวอย่างแถวสำหรับอ้างอิง

ตัวอย่างที่มีอยู่ในโปรเจกต์: `config/example-template.xlsx` และไฟล์ข้อมูลตัวอย่าง (มีแถวผิดพลาด 2 แถวตั้งใจ)
ที่ `data/example-customers.xlsx` — สร้างใหม่ได้ด้วย `npm run sample`

> รองรับเฉพาะไฟล์ `.xlsx` / `.xlsm` (ไฟล์ `.xls` เดิมให้บันทึกเป็น `.xlsx` ก่อน)

---

## 6. พฤติกรรมการเขียนลงฐานข้อมูล

- ใช้ `INSERT INTO ... ON DUPLICATE KEY UPDATE` โดยอิง unique key ของตาราง (ระบบเลือก syntax ตามเวอร์ชัน MySQL อัตโนมัติ: `AS new` สำหรับ 8.0.19+ และ `VALUES()` สำหรับรุ่นเก่า)
- ทุกงานรันใน **transaction เดียว** — ถ้า `onError=abort` จะ rollback ทั้งหมด
- นับผลได้แม่นยำ: **เพิ่มใหม่ / อัปเดต / ไม่เปลี่ยน / ผิดพลาด** (อิง `affectedRows` ตามหลักของ MySQL)
- แถวที่ผิดพลาดจะถูกข้ามโดยไม่กระทบแถวอื่น และถูกบันทึกลงตาราง `sync_job_error` พร้อมเลขแถว
- ชื่อตาราง/คอลัมน์ถูก escape ด้วย backtick ทุกจุด (ป้องกัน SQL injection) และใช้ prepared statement เสมอ

### ตารางระบบที่ระบบสร้างให้อัตโนมัติ

| ตาราง | เก็บอะไร |
|---|---|
| `sync_job_log` | ประวัติแต่ละงาน: ไฟล์, ตาราง, จำนวนแถว, เวลา, สถานะ |
| `sync_job_error` | รายละเอียดข้อผิดพลาดรายแถว (เลขแถว, คอลัมน์, ข้อความ, ค่าที่ผิด) |

ปิดการสร้างตารางเหล่านี้ได้ด้วย `CREATE_JOB_LOG_TABLE=false`

---

## 7. โครงสร้างโปรเจกต์

```
src/
  cli.ts              คำสั่ง CLI ทั้งหมด
  server.ts           เว็บเซิร์ฟเวอร์ Express
  config/             อ่าน .env, schema ของไฟล์ mapping (zod)
  core/               ตรรกะหลัก: convert, validate, upsert (SQL), job
  db/                 client (pool/transaction), introspect (information_schema, job log)
  excel/              reader (อ่านไฟล์), template (สร้างไฟล์ Template)
  store/              เก็บไฟล์ที่อัปโหลดและ mapping ที่บันทึกจาก Web UI
  web/routes.ts       REST API ทั้งหมด
public/               Web UI (HTML/CSS/JS ไม่ต้อง build)
config/               ตัวอย่างไฟล์ mapping
data/                 ไฟล์ข้อมูลตัวอย่าง
scripts/              สร้างข้อมูลตัวอย่าง / smoke test
tests/                unit + integration tests
```

---

## 8. การทดสอบ

```bash
npm test            # unit tests (ไม่ต้องมีฐานข้อมูล)
npm run typecheck   # ตรวจ TypeScript
npm run smoke       # ทดสอบ API ของ Web UI (ต้องเปิด serve อยู่)
```

### ทดสอบกับ MySQL จริง

ไฟล์ `tests/integration.test.ts` จะข้ามตัวเอง **เว้นแต่จะตั้งค่า `DB_TEST=true`** วิธีรัน:

```bash
# Windows PowerShell
$env:DB_HOST='127.0.0.1'; $env:DB_NAME='syncdb_test'; $env:DB_USER='root'; $env:DB_PASSWORD='yourpass'
$env:DB_TEST='true'
npx vitest run tests/integration.test.ts
```

```bash
# Linux / macOS
DB_HOST=127.0.0.1 DB_NAME=syncdb_test DB_USER=root DB_PASSWORD=yourpass DB_TEST=true \
  npx vitest run tests/integration.test.ts
```

> ตัวแปร `DB_TEST` เป็นตัวควบคุม (opt-in) เพื่อไม่ให้เทสต์ไปแตะฐานข้อมูลจริงโดยไม่ตั้งใจ ถ้าไม่ตั้งค่า เทสต์จะขึ้นเป็น `skipped`

เทสต์นี้จะสร้างตารางชั่วคราว นำเข้าข้อมูลจริง ตรวจการ upsert แล้วลบตารางทิ้ง

---

## 9. หมายเหตุ / ข้อควรระวัง

- ระบบรองรับการ **เพิ่มและอัปเดต** เท่านั้น ไม่มีการลบแถวที่ไม่อยู่ในไฟล์ (เพื่อความปลอดภัย) — ถ้าต้องการลบให้เขียน SQL เพิ่มเติมเอง
- `mode: upsert` ต้องกำหนด `keys` เสมอ และ `keys` ต้องอยู่ใน `columns`
- ถ้าไฟล์ Excel มีหัวตารางหลายชั้น ให้ตั้ง `headerRow` ให้ตรงกับแถวที่ใช้จริง (ระบบตรวจจับให้อัตโนมัติเมื่ออัปโหลดผ่าน Web UI)
- ไฟล์ที่อัปโหลดผ่าน Web UI จะถูกเก็บไว้ใน `storage/uploads/` — ควรล้างไฟล์เก่าเป็นระยะ
- ควรให้สิทธิ์ MySQL เฉพาะที่จำเป็น (`SELECT`, `INSERT`, `UPDATE`, `CREATE`) และหลีกเลี่ยงการใช้ `root`
