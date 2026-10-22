# SyncDBJOB — ระบบนำเข้าข้อมูลจากไฟล์ Excel Template เข้าฐานข้อมูล MySQL

ระบบ Transfer ข้อมูลจากไฟล์ Excel (Template) เข้าสู่ฐานข้อมูล MySQL แบบ **Upsert**
(เพิ่มใหม่ถ้าไม่มี / อัปเดตของเดิมถ้ามี) พร้อม Web UI สำหรับอัปโหลดไฟล์และกำหนดการจับคู่คอลัมน์แบบ visual

---

## 1. ความต้องการระบบ

| รายการ | รุ่น/รายละเอียด |
|---|---|
| Node.js | 18.18+ (ทดสอบด้วย v24) |
| MySQL | 5.7 / 8.0+ หรือ **MariaDB 10.x** (เชื่อมต่อเป็น **Remote Server**) |
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

ถ้าเปิด Web UI ต้องมีบัญชีผู้ใช้สำหรับล็อกอินด้วย (ดูรายละเอียดในหัวข้อ 3.3):

```bash
npm run dev -- user list                              # ดูผู้ใช้ที่มีอยู่
npm run dev -- user add -u admin -p 'รหัสผ่าน' -r ADMIN  # เพิ่ม/ตั้งรหัสผ่านใหม่
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
| `--dry-run` | — | ตรวจสอบอย่างเดียว **ไม่เขียนลง DB จริง** แต่ยังรายงานได้ว่าจะเพิ่มใหม่/อัปเดตกี่แถว |

> เมื่อ `--batch-size > 1` และคำสั่งรวมแถวล้มเหลว ระบบจะ fallback ไปทำทีละแถวอัตโนมัติ
> เพื่อหาแถวที่มีปัญหาจริง ๆ โดยไม่ทำให้ทั้งชุดล้มเหลว

### 3.3 ระบบล็อกอิน (Login) 🔒

Web UI มีระบบล็อกอินในตัวแอป **เปิดใช้งานโดยค่าเริ่มต้น** — ทุก route ของ API และทุกหน้าเว็บ
จะถูกป้องกันด้วย session cookie (ไม่มีใครเข้ามาเขียนลงฐานข้อมูลจริงได้โดยไม่ล็อกอิน)

**ผู้ใช้มาจากตาราง `newfin_users` ในฐานข้อมูล** (เปลี่ยนชื่อตารางได้ด้วย `AUTH_USERS_TABLE`)

| คอลัมน์ที่ต้องมี | ใช้ทำอะไร |
|---|---|
| `USERNAME` | ชื่อผู้ใช้ (ต้อง UNIQUE) |
| `PASSWORD_HASH` | รหัสผ่านแบบ **bcrypt** (`$2a$`/`$2b$`/`$2y$`) |
| `FULL_NAME` | ชื่อ-นามสกุลที่แสดงบนหน้าเว็บ (ไม่บังคับ) |
| `ROLE` | บทบาท — `ADMIN` ลบ mapping/ไฟล์ได้, `USER` ใช้งานทั่วไป |
| `USER_ACTIVE` | `1` = ใช้งานได้, `0` = ปิดบัญชี |

การทำงาน

1. เปิดหน้าเว็บ → ระบบพาไปหน้า `/login` อัตโนมัติ
2. กรอกชื่อผู้ใช้/รหัสผ่าน → ระบบตรวจสอบกับตารางผู้ใช้ → สร้าง session
3. ใช้งานได้ตามปกติ ดูชื่อผู้ใช้/บทบาทมุมขวาบน และกด **ออกจากระบบ** เพื่อจบ session
4. ถ้ายังไม่ล็อกอินแล้วเรียก API → ได้ `401 {"authRequired": true}` / เว็บ → redirect ไป `/login`

ความปลอดภัยที่มี

| เรื่อง | รายละเอียด |
|---|---|
| รหัสผ่าน | เก็บเป็น bcrypt hash — ระบบไม่เก็บรหัสผ่านจริง และไม่ log รหัสผ่าน |
| Session | cookie ชื่อ `sdj_session` แบบ `HttpOnly` + `SameSite=Lax` (+ `Secure` เมื่อเข้าผ่าน HTTPS) |
| ปลอมแปลง cookie | ค่า session ถูกเซ็นด้วย HMAC-SHA256 — แก้ค่าเองแล้วใช้ไม่ได้ |
| เดารหัสผ่าน | ล็อกชั่วคราว 10 ครั้ง / 15 นาที (ต่อชื่อผู้ใช้ + IP) |
| เดาชื่อผู้ใช้ | ข้อความ error เหมือนกันทั้ง "ไม่พบผู้ใช้" และ "รหัสผ่านผิด" |
| สิทธิ์ | ลบ mapping / ลบไฟล์ที่อัปโหลด ต้องเป็น `ADMIN` |
| `/api/health` | เข้าถึงได้โดยไม่ต้องล็อกอิน (ใช้ตรวจระบบ) แต่ซ่อนชื่อฐานข้อมูลไว้จนกว่าจะล็อกอิน |

ตั้งค่าใน `.env`

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `APP_AUTH_ENABLED` | `true` | เปิด/ปิดระบบล็อกอิน (ปิดไว้ได้เฉพาะตอนทดลองบนเครื่อง) |
| `AUTH_USERS_TABLE` | `newfin_users` | ชื่อตารางผู้ใช้ |
| `APP_SESSION_SECRET` | ว่าง | คีย์เซ็น cookie — ถ้าว่างจะสร้างและบันทึกที่ `storage/.session-secret` ให้อัตโนมัติ |
| `APP_SESSION_TTL_HOURS` | `12` | อายุ session (ชั่วโมง) |
| `APP_LOGIN_MAX_ATTEMPTS` | `10` | จำนวนครั้งที่ล้มเหลวได้ก่อนถูกล็อก |
| `APP_LOGIN_LOCK_MINUTES` | `15` | เวลาล็อก (นาที) |
| `APP_TRUST_PROXY` | `false` | เปิดเมื่อวางหลัง nginx/reverse proxy |

จัดการผู้ใช้จาก CLI

```bash
npm run dev -- user list                                  # ดูผู้ใช้ทั้งหมด
npm run dev -- user add -u admin -p 'รหัสผ่านใหม่' -r ADMIN   # เพิ่มผู้ใช้ / ตั้งรหัสผ่านใหม่
npm run dev -- user add -u staff01 -p 'รหัสผ่าน' --full-name 'ชื่อ ทดสอบ'
npm run dev -- user enable -u staff01                     # เปิดใช้งาน
npm run dev -- user enable -u staff01 --disable           # ปิดใช้งาน
npm run dev -- user remove -u staff01 --yes               # ลบผู้ใช้
```

> `user add` จะ **อัปเดตรหัสผ่าน** ของผู้ใช้เดิมถ้าชื่อซ้ำ (ใช้ตั้งรหัสผ่านใหม่ได้)
> รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร

> ⚠️ คำสั่ง CLI เหล่านี้ **ไม่ต้องล็อกอิน** เพราะรันจาก shell ของเซิร์ฟเวอร์ที่ผู้ดูแลถือสิทธิ์อยู่แล้ว
> ให้จำกัดสิทธิ์ผู้ใช้ระบบ (`syncdb`) และสิทธิ์ไฟล์ `.env` ให้เหมาะสม

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

- ใช้ `INSERT INTO ... ON DUPLICATE KEY UPDATE` โดยอิง unique key ของตาราง
- ระบบเลือก syntax อัตโนมัติจาก `VERSION()` ของเซิร์ฟเวอร์:
  | เซิร์ฟเวอร์ | syntax ที่ใช้ |
  |---|---|
  | MySQL ≥ 8.0.19 | `INSERT ... AS new ON DUPLICATE KEY UPDATE col = new.col` |
  | MySQL < 8.0.19 | `INSERT ... ON DUPLICATE KEY UPDATE col = VALUES(col)` |
  | **MariaDB (ทุกรุ่น)** | `INSERT ... ON DUPLICATE KEY UPDATE col = VALUES(col)` ← MariaDB ไม่รองรับ alias `AS new` |
- บังคับชนิดเซิร์ฟเวอร์เองได้ด้วย `DB_DIALECT=auto|mysql|mariadb` ใน `.env` (ค่าเริ่มต้น `auto` = ตรวจจับเอง)
- ทุกงานรันใน **transaction เดียว** — ถ้า `onError=abort` จะ rollback ทั้งหมด
- นับผลได้แม่นยำทั้งบน MySQL และ MariaDB: **เพิ่มใหม่ / อัปเดต / ไม่เปลี่ยน / ผิดพลาด**
  - MariaDB คืน `affectedRows=1` ทั้งตอน insert ใหม่และ update ที่ค่าไม่เปลี่ยน ระบบจึงตรวจ key ที่มีอยู่ล่วงหน้า 1 คำสั่งก่อนเขียน เพื่อแยกสองกรณีนี้
- แถวที่ผิดพลาดจะถูกข้ามโดยไม่กระทบแถวอื่น และถูกบันทึกลงตาราง `sync_job_error` พร้อมเลขแถว
- ชื่อตาราง/คอลัมน์ถูก escape ด้วย backtick ทุกจุด (ป้องกัน SQL injection) และใช้ prepared statement เสมอ
- `--dry-run` (CLI) และปุ่ม **ทดลองนำเข้า (ไม่เขียน DB)** (Web UI) จะ **ไม่เขียนอะไรลงฐานข้อมูลเลย** และไม่บันทึกประวัติงาน แต่ยังรายงานได้ว่าจะเพิ่มใหม่/อัปเดตกี่แถว

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
  auth/               ระบบล็อกอิน: password (bcrypt), session (cookie), service, middleware
  config/             อ่าน .env, schema ของไฟล์ mapping (zod)
  core/               ตรรกะหลัก: convert, validate, upsert (SQL), job
  db/                 client (pool/transaction), pool, users (ตารางผู้ใช้), introspect
  excel/              reader (อ่านไฟล์), template (สร้างไฟล์ Template)
  store/              เก็บไฟล์ที่อัปโหลดและ mapping ที่บันทึกจาก Web UI
  web/routes.ts       REST API ทั้งหมด
public/               Web UI (HTML/CSS/JS ไม่ต้อง build) — index + login
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

ถ้าเปิดระบบล็อกอินไว้ (ค่าเริ่มต้น) ให้ส่งข้อมูลเข้าสู่ระบบตอนรัน smoke test:

```bash
# Windows PowerShell
$env:SMOKE_USERNAME='admin'; $env:SMOKE_PASSWORD='xxxx'
npm run smoke

# Linux / macOS
SMOKE_USERNAME=admin SMOKE_PASSWORD=xxxx npm run smoke
```

> ถ้าไม่ใส่ข้อมูล สคริปต์จะทดสอบเฉพาะส่วนที่ไม่ต้องล็อกอิน (เช่น หน้า `/login` และการตอบ 401) แล้วจบ
> หรือปิดระบบล็อกอินชั่วคราวด้วย `APP_AUTH_ENABLED=false`

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

## 9. การติดตั้งบนเซิร์ฟเวอร์ (Deploy)

### 9.1 ข้อควรระวังก่อนขึ้น Internet

> ✅ **ระบบมี Login ภายในแอปแล้ว** (หัวข้อ 3.3) — ผู้ใช้ต้องล็อกอินด้วยบัญชีในตาราง `newfin_users`
> ก่อนใช้งานจริง ตรวจสอบว่า:
> - มีบัญชี `ADMIN` ที่รหัสผ่านถูกต้อง (ถ้าไม่รู้รหัสเดิม ใช้ `npm run dev -- user add -u admin -p 'รหัสใหม่' -r ADMIN`)
> - `APP_AUTH_ENABLED=true` ใน `.env` และ `APP_TRUST_PROXY=true` ถ้าวางหลัง nginx
> - ปิดบัญชีที่ไม่ใช้แล้ว (`npm run dev -- user enable -u <ชื่อ> --disable`)
>
> ยังควรทำเพิ่ม (แนะนำ):
> 1. ผูกพอร์ตไว้ที่ `127.0.0.1` แล้วเข้าผ่าน nginx (มีไฟล์ตัวอย่างใน `deploy/nginx.conf`)
> 2. ใส่ **Basic Auth ของ nginx** อีกชั้นไว้หน้า ( defense in depth ) — มีไฟล์ `deploy/nginx.conf` ให้อยู่แล้ว
> 3. ใช้ HTTPS (certbot) — cookie จะถูกตั้ง flag `Secure` อัตโนมัติเมื่อ request เป็น HTTPS

### 9.2 ทางเลือก A — Ubuntu/Debian VPS (nginx + systemd) แนะนำ

```bash
sudo bash deploy/install.sh
```

สคริปต์จะทำให้อัตโนมัติ: ติดตั้ง Node.js 22, ดึงโค้ดจาก GitHub, `npm ci` + build,
สร้างผู้ใช้ระบบ `syncdb` (ไม่มี login shell), ติดตั้ง systemd service และ nginx

จากนั้นทำต่อ:

```bash
# 1) ใส่ค่าการเชื่อมต่อฐานข้อมูลจริง
sudo nano /opt/syncdbjob/.env

# 2) ใส่โดเมนจริงในไฟล์ nginx (2 จุด)
sudo nano /etc/nginx/sites-available/syncdbjob

# 3) สร้างรหัสผ่านสำหรับเข้า Web UI
sudo htpasswd -c /etc/nginx/.htpasswd admin

# 4) ทดสอบเชื่อมต่อ DB
cd /opt/syncdbjob && npm run dev -- check

# 5) เริ่มบริการ
sudo systemctl start syncdbjob
sudo systemctl status syncdbjob

# 6) ขอใบรับรอง SSL
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com

# 7) ทดสอบ
curl -u admin http://127.0.0.1:3000/api/health
```

คำสั่งจัดการบริการ:

```bash
sudo systemctl restart syncdbjob     # เริ่มใหม่
sudo systemctl stop syncdbjob        # หยุด
sudo journalctl -u syncdbjob -f      # ดู log สด
```

### 9.3 ทางเลือก B — Docker

```bash
docker compose up -d --build
docker compose logs -f
```

ตัวอย่าง `docker-compose.yml` ผูกพอร์ตไว้ที่ `127.0.0.1:3000` เท่านั้น (ต้องให้ nginx เป็นตัวรับคำขอ)
และ mount `./storage` ไว้เพื่อไม่ให้ mapping/ไฟล์ที่อัปโหลดหายเมื่อ deploy ใหม่

### 9.4 สิ่งที่ต้องดูแลหลังขึ้น Host

| เรื่อง | วิธีจัดการ |
|---|---|
| ไฟล์ `.env` | `chmod 600` + อยู่ใน `.gitignore` แล้ว — **ห้าม commit** |
| โฟลเดอร์ `storage/` | ต้องมีสิทธิ์เขียนของผู้ใช้ service (`syncdb`) |
| `process.cwd()` | โค้ดอ้างอิง `public/` และ `storage/` ผ่าน cwd — service ต้องตั้ง `WorkingDirectory` ให้ถูก |
| ไฟล์อัปโหลด | `storage/uploads/` สูงสุด 100MB/ไฟล์ ควรล้างไฟล์เก่าเป็นระยะ |
| ประวัติงาน | เก็บในตาราง `sync_job_log` / `sync_job_error` (อยู่ในฐานข้อมูลจริง) |
| ตารางผู้ใช้ | `newfin_users` (หรือตาม `AUTH_USERS_TABLE`) — ต้องมีสิทธิ์ `SELECT` และถ้าจะใช้คำสั่ง `user add` ต้องมี `INSERT`/`UPDATE` ด้วย |
| ไฟล์ `storage/.session-secret` | คีย์เซ็น cookie — อยู่ใน `.gitignore` แล้ว ถ้าหาย session จะหมดอายุ (ผู้ใช้ล็อกอินใหม่ได้) |
| nginx | `client_max_body_size 120M` ต้อง ≥ ขนาดไฟล์ที่อัปโหลดได้ |
| สิทธิ์ DB | ควรใช้ user ที่มีสิทธิ์เฉพาะ `SELECT, INSERT, UPDATE, CREATE` บนตารางที่เกี่ยวข้อง |
| สำเนาสำรอง | `mysqldump` ตารางประวัติงาน + โฟลเดอร์ `storage/` เป็นระยะ |

> 💡 รหัสผ่าน DB ใน `.env` มีอักขระ `$` — ถ้าจะ `source .env` ใน bash ให้หนีคำสั่ง `$` ก่อน
> (`APP_PASSWORD='pa$$word'` → `'pa$$word'`) แต่ไฟล์ systemd/nginx อ่านค่าแบบตรง ๆ ไม่ต้องหนี

### 9.5 ทางเลือก C — Shared Hosting ที่ติดตั้งใต้โฟลเดอร์ย่อย (เช่น `ebcitrade.com/SyncJOB`)

ใช้เมื่อโฮสติ้งมีโฟลเดอร์ย่อยให้ (shared hosting / cPanel / Plesk) และ URL คือ
`https://ebcitrade.com/SyncJOB/` — แอปรองรับโหมดนี้อยู่แล้ว

#### สิ่งที่ต้องเตรียม

| รายการ | รายละเอียด |
|---|---|
| Node.js | ต้องมี **v18.18+** (แนะนำ v22) — cPanel ให้เลือกเวอร์ชันได้ที่ "Setup Node.js App" |
| ที่อยู่แอป | โฟลเดอร์ที่มี `package.json` เช่น `/home/USER/SyncJOB` |
| Startup file | `dist/cli.js` (ต้อง build ก่อน) |
| Startup command | `node dist/cli.js serve` |
| พอร์ต | ถ้าโฮสติ้งส่งค่า `PORT` มาให้ ระบบจะใช้ให้อัตโนมัติ (ไม่ต้องตั้ง `APP_PORT`) |
| ฐานพาธ | ตั้ง `APP_BASE_PATH=/SyncJOB` ใน `.env` |
| สิทธิ์เขียน | โฟลเดอร์ `storage/` ต้องเขียนได้ (ไฟล์อัปโหลด + mapping + ไฟล์ template + คีย์ session) |
| โครงสร้าง URL | ต้องทำให้ `https://ebcitrade.com/SyncJOB/api/*` ถูกส่งต่อมาที่แอป (rewrite / proxy) |

#### ขั้นตอน (ตัวอย่าง cPanel)

1. **อัปโหลดโค้ด** เข้าโฟลเดอร์ `SyncJOB` (ผ่าน FTP / Git Versioning / SSH)
2. **สร้าง `.env`** ในโฟลเดอร์นั้น (คัดลอกจาก `.env.example` แล้วแก้ค่า DB)

   ```bash
   APP_BASE_PATH=/SyncJOB
   APP_HOST=127.0.0.1
   APP_PORT=3000          # เว้นว่างไว้ก็ได้ ถ้าโฮสติ้งส่ง PORT มาให้
   DB_HOST=ebcitrade.com
   DB_USER=...
   DB_PASSWORD=...
   DB_NAME=...
   ```

3. **Build** (ถ้าโฮสติ้งให้รันคำสั่งตอนตั้งค่าใส่ `npm ci && npm run build`)
4. **ตั้งค่า Node.js App**
   - Node.js version: 22
   - Application root: `SyncJOB`
   - Application URL: `SyncJOB`
   - Application startup file: `dist/cli.js`
   - Startup command: `serve`
5. **Restart** แอป แล้วเปิด `https://ebcitrade.com/SyncJOB/`

#### ข้อควรระวัง

- ถ้าโฮสติ้ง**หยุดแอปหลังไม่มีคนเข้าใช้งาน** (idle timeout) ให้ตั้งค่าให้เปิดทำงานต่อเนื่อง
- ถ้าโฮสติ้งให้ Node.js เขียนไฟล์ไม่ได้นอกโฟลเดอร์แอป ให้ย้าย `STORAGE_DIR` ไปยังโฟลเดอร์ที่เขียนได้
- ถ้าต้องการรันงานตามเวลา (cron) ให้ใช้ CLI ของแอปแทน เช่น
  `node dist/cli.js sync --file uploads/xxx.xlsx --mapping mappings/yyy.json`
- ตรวจสอบว่า DB เปิดให้เชื่อมต่อจากโฮสติ้งได้ (พอร์ต 3306 ขาออก)

---

## 10. หมายเหตุ / ข้อควรระวัง

- ระบบรองรับการ **เพิ่มและอัปเดต** เท่านั้น ไม่มีการลบแถวที่ไม่อยู่ในไฟล์ (เพื่อความปลอดภัย) — ถ้าต้องการลบให้เขียน SQL เพิ่มเติมเอง
- `mode: upsert` ต้องกำหนด `keys` เสมอ และ `keys` ต้องอยู่ใน `columns`
- ถ้าไฟล์ Excel มีหัวตารางหลายชั้น ให้ตั้ง `headerRow` ให้ตรงกับแถวที่ใช้จริง (ระบบตรวจจับให้อัตโนมัติเมื่ออัปโหลดผ่าน Web UI)
- ไฟล์ที่อัปโหลดผ่าน Web UI จะถูกเก็บไว้ใน `storage/uploads/` — ควรล้างไฟล์เก่าเป็นระยะ
- ควรให้สิทธิ์ MySQL เฉพาะที่จำเป็น (`SELECT`, `INSERT`, `UPDATE`, `CREATE`) และหลีกเลี่ยงการใช้ `root`
