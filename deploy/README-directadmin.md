# คู่มือติดตั้ง SyncDBJOB บน DirectAdmin

> สำหรับโฮสติ้งที่ใช้ **DirectAdmin** (ไม่ใช่ cPanel)
> ตัวอย่างโดเมน: `ebcitrade.com` — ติดตั้งใต้โฟลเดอร์ `ebcitrade.com/SyncJOB`

---

## ⚠️ ข้อสำคัญที่สุด: อย่าวางโค้ดไว้ใน public_html

DirectAdmin เสิร์ฟไฟล์ใน `public_html/` ด้วย Apache/nginx **โดยตรง**
ถ้าวางแอปไว้ที่นั่น → ไฟล์ `.env` (มีรหัสผ่าน DB) จะถูกเปิดดูได้จากเว็บ!

```
✗ ห้าม:  /home/USER/domains/ebcitrade.com/public_html/SyncJOB/   ← .env โดนเห็น
✓ ถูกต้อง: /home/USER/syncdbjob/                                ← นอก public_html
```

แล้วให้ nginx ส่งต่อ (reverse proxy) จาก `/SyncJOB/` → `127.0.0.1:3000` แทน

---

## 1. เช็คสิ่งที่ DirectAdmin ของคุณมีให้

เข้า DirectAdmin แล้วดูเมนูระดับ **User Level**:

| ต้องการ | ดูที่ไหน | ถ้าไม่มีแปลว่า |
|---|---|---|
| **SSH** | Account Manager → "SSH Access" / "Manage Account" | เปิดให้บัญชี หรือใช้ File Manager + Application Manager แทน |
| **Node.js** | เมนู "Setup Node.js App" / "Application Manager" / "Node.js Selector" | ต้องติดตั้ง Node เองด้วย SSH (ดูข้อ 3) |
| **Reverse Proxy** | เมนู "nginx Reverse Proxy" | ใช้วิธีเปลี่ยนเป็น subdomain (ดูข้อ 8) |

> ชื่อเมนูต่างกันตามเวอร์ชัน DirectAdmin — ถ้าไม่เห็น ให้เปิดเมนูทุกตัวดู

---

## 2. เข้า SSH

DirectAdmin ให้ user แยกต่อ domain ได้ ปกติชื่อ user = ชื่อ account ของคุณ
(ตรวจได้ที่ **Account Manager → Manage Account → Username**)

```powershell
ssh ชื่อผู้ใช้@ebcitrade.com
```

พอเข้าแล้ว:

```bash
pwd            # มักเป็น /home/ชื่อผู้ใช้
whoami         # ชื่อผู้ใช้
ls -la         # ดูว่ามีโฟลเดอร์อะไรบ้าง
ls domains/    # ดูโดเมนที่มี
```

---

## 3. ติดตั้ง Node.js 22 (ถ้าโฮสติ้งไม่มีให้)

บัญชี DirectAdmin ปกติไม่มี `sudo` → ใช้ **nvm** (ติดตั้งใน home ของตัวเอง)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"

nvm install 22
nvm alias default 22
nvm use 22

node -v    # ต้องได้ v22.x
npm -v
```

> ถ้า DirectAdmin มี "Setup Node.js App" ให้เลือกเวอร์ชัน 22 ตรงนั้นแทน → ไม่ต้องติดตั้งเอง

---

## 4. วางโค้ด (นอก public_html)

```bash
APP_DIR="$HOME/syncdbjob"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# วิธีที่ 1: clone จาก GitHub (repo เป็น Private → ต้องมี deploy key หรือ token)
git clone git@github.com:intrawebmis/SyncDBJOB.git .
# ถ้าใช้ token:
# git clone https://<TOKEN>@github.com/intrawebmis/SyncDBJOB.git .

# วิธีที่ 2: อัปโหลด ZIP ผ่าน File Manager → แตกในโฟลเดอร์นี้
```

---

## 5. ติดตั้ง dependencies + build

```bash
cd "$HOME/syncdbjob"
npm ci
npm run build

mkdir -p storage/uploads storage/mappings storage/exports
```

---

## 6. สร้างไฟล์ `.env`

```bash
cd "$HOME/syncdbjob"
cp .env.example .env
nano .env
```

```bash
# ===== การเชื่อมต่อ MySQL (Remote) =====
DB_HOST=ebcitrade.com
DB_PORT=3306
DB_USER=ebciadmin_ebci
DB_PASSWORD=@4u2meEbci$
DB_NAME=ebciadmin_ebcitrade2015
DB_SSL=false
DB_DIALECT=auto

# ===== Web UI =====
APP_HOST=127.0.0.1          # ผูกกับ localhost เท่านั้น (nginx เป็นคนเข้ามา)
APP_PORT=3000
APP_BASE_PATH=/SyncJOB      # ← ติดตั้งใต้โฟลเดอร์ย่อย
APP_TRUST_PROXY=true        # ← ต้องเป็น true เพราะอยู่หลัง nginx

# ===== ระบบล็อกอิน =====
APP_AUTH_ENABLED=true
AUTH_USERS_TABLE=newfin_users
APP_SESSION_SECRET=
APP_SESSION_TTL_HOURS=12
APP_LOGIN_MAX_ATTEMPTS=10
APP_LOGIN_LOCK_MINUTES=15

# ===== พฤติกรรม =====
SYNC_ON_ERROR=skip
SYNC_BATCH_SIZE=1
CREATE_JOB_LOG_TABLE=true
STORAGE_DIR=storage
LOG_LEVEL=info
```

> รหัสผ่านมี `$` — ถ้าใช้ `source .env` ให้หนี: `DB_PASSWORD='@4u2meEbci$'`

---

## 7. สร้างบัญชีล็อกอิน

```bash
cd "$HOME/syncdbjob"
node dist/cli.js user list
node dist/cli.js user add -u admin -p 'รหัสผ่าน' -r ADMIN
```

---

## 8. ให้โปรเซสทำงานต่อเนื่อง (DirectAdmin ไม่มี systemd)

ใช้ **pm2**:

```bash
npm install -g pm2

cd "$HOME/syncdbjob"
pm2 start dist/cli.js --name syncdbjob -- serve
pm2 save
pm2 startup          # จะพิมพ์คำสั่งกลับมา → คัดลอกไปรัน (ต้องมี sudo)
```

ถ้าไม่มี `sudo` (ใช้ crontab แทน):

```bash
crontab -e
```
เพิ่มบรรทัดนี้:
```
@reboot /bin/bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd ~/syncdbjob && exec ~/.nvm/versions/node/v22.*/bin/node dist/cli.js serve' >> ~/syncdbjob/storage/app.log 2>&1
```

ตรวจสอบว่ารันอยู่:

```bash
pm2 list
pm2 logs syncdbjob
curl http://127.0.0.1:3000/SyncJOB/api/health
# ต้องได้ {"ok":true,"connected":true,...}
```

---

## 9. ตั้ง Reverse Proxy (nginx → แอป)

### วิธี A — เมนู "nginx Reverse Proxy" ของ DirectAdmin (ถ้ามี)

| ช่อง | ค่า |
|---|---|
| Location / URL | `/SyncJOB/` |
| Proxy URL | `http://127.0.0.1:3000/SyncJOB/` |
| Redirect to HTTPS | เปิด (ถ้าเว็บใช้ SSL) |

### วิธี B — แก้ custom nginx config (Admin เท่านั้น)

สร้างไฟล์ `/usr/local/directadmin/custom/nginx.conf` (หรือรวมเข้าไฟล์เดิม):

```nginx
location /SyncJOB/ {
    proxy_pass         http://127.0.0.1:3000/SyncJOB/;
    proxy_http_version 1.1;

    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;

    client_max_body_size 120M;
    proxy_connect_timeout 60s;
    proxy_send_timeout    300s;
    proxy_read_timeout    300s;
    proxy_request_buffering off;
}

location = /SyncJOB {
    return 301 /SyncJOB/;
}
```

แล้ว reload nginx:
```bash
nginx -t && nginx -s reload      # หรือ sudo nginx -t && sudo nginx -s reload
```

### วิธี C — ใช้ subdomain แทน (ทางเลือกที่ง่ายที่สุด)

ถ้าตั้ง reverse proxy ไม่ได้:
1. DirectAdmin → **Account Manager → Subdomain Accounts** → สร้าง `syncjob.ebcitrade.com`
2. ใส่ `.env`: `APP_BASE_PATH=` (ว่าง = อยู่ที่ root)
3. ชี้ subdomain ที่ nginx reverse proxy ไป `http://127.0.0.1:3000/`
4. เข้า `https://syncjob.ebcitrade.com`

---

## 10. ทดสอบ

```bash
# จากบน host
curl http://127.0.0.1:3000/SyncJOB/api/health

# จากเครื่องตัวเอง (ผ่าน nginx)
curl https://ebcitrade.com/SyncJOB/api/health
```

เปิดเบราว์เซอร์ → `https://ebcitrade.com/SyncJOB/` → ต้องเจอหน้า **เข้าสู่ระบบ**

---

## 11. อัปเดตครั้งถัดไป

```bash
cd ~/syncdbjob
git pull --ff-only origin main
npm ci
npm run build
pm2 restart syncdbjob
```

---

## 12. ปัญหาที่พบบ่อย

| อาการ | วิธีแก้ |
|---|---|
| 404 ที่ `/SyncJOB/` | nginx ไม่ได้ proxy path นี้ → ตรวจ `nginx -T \| grep -A5 SyncJOB` |
| หน้าเว็บว่าง | โหลด static ไม่ได้ → ตรวจว่า `APP_BASE_PATH` ตรงกับ URL |
| Login แล้วเด้งกลับหน้า login | `APP_TRUST_PROXY=true` ยังไม่ได้ตั้ง → cookie `Secure` ไม่ถูกส่งกลับ |
| 502 Bad Gateway | แอปไม่ได้รัน → `pm2 logs syncdbjob` |
| ไฟล์อัปโหลดไม่ได้ | nginx `client_max_body_size 120M` + โฟลเดอร์ `storage/` ต้องเขียนได้ |
| เจอไฟล์ `.env` เปิดได้จากเว็บ | ย้ายโค้ดออกจาก `public_html` ทันที (ดูข้อ 1) |
| `EACCES` เขียนไฟล์ไม่ได้ | `chmod -R u+rwX storage` |
| เข้าเว็บแล้ว session หมดทุกครั้ง | ตั้ง `APP_SESSION_SECRET` เป็นค่าคงที่ หรือปล่อยให้ระบบสร้างใน `storage/.session-secret` |

---

## 13. โครงสร้างบน host

```
/home/USER/
├── syncdbjob/                 ← แอป (นอก public_html)
│   ├── .env                   ← chmod 600 — ห้ามหลุดขึ้นเว็บ
│   ├── dist/  public/  node_modules/
│   └── storage/               ← ต้องเขียนได้
│       ├── .session-secret
│       ├── uploads/  mappings/  exports/
└── domains/ebcitrade.com/
    └── public_html/           ← ว่างเปล่า (ไม่เก็บโค้ดแอปไว้ตรงนี้)
```
