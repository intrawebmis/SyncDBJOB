# คู่มือติดตั้ง SyncDBJOB บน Host (Ubuntu/Debian)

> โค้ดอยู่ที่ `git@github.com:intrawebmis/SyncDBJOB.git` (Private)
> ทุกครั้งที่ต้องการอัปเดต ให้รันคำสั่ง **อัปเดต** ท้ายสุดของไฟล์นี้

---

## สรุปสั้น ๆ (ทางลัด)

```bash
# 1) เตรียม SSH key ของ host (ทำครั้งเดียว) — ดูหัวข้อ 1
ssh-keygen -t ed25519 -C "syncdbjob@host" -N ""

# 2) ติดตั้ง (สคริปต์ทำให้ทั้งหมด)
sudo bash deploy/install.sh

# 3) แก้ .env
sudo nano /opt/syncdbjob/.env

# 4) รันสคริปต์อีกรอบเพื่อจบการติดตั้ง
sudo bash /opt/syncdbjob/deploy/install.sh

# 5) สร้างบัญชีล็อกอิน
cd /opt/syncdbjob && sudo -u syncdb npm run dev -- user add -u admin -p 'รหัสผ่าน' -r ADMIN

# 6) เริ่ม service
sudo systemctl start syncdbjob
sudo systemctl status syncdbjob
```

---

## 1. เตรียม SSH key ของ Host (สำคัญ — repo เป็น Private)

Repo เป็น Private � host จึงต้องมี SSH key ที่ GitHub รู้จัก

```bash
# สร้าง key (ถ้ายังไม่มี)
ssh-keygen -t ed25519 -C "syncdbjob@host" -N ""
cat ~/.ssh/id_ed25519.pub
```

นำคีย์สาธารณะที่ได้ไปใส่ใน GitHub:

`repo → Settings → Deploy keys → Add deploy key` → ติ๊ก **Allow write access** (ถ้าจะใช้ `git pull` อัปเดตเอง) หรือไม่ติ๊กก็ได้ถ้าจะ pull เองด้วย user คนอื่น

**ทางเลือก: ใช้ HTTPS + Personal Access Token** (ถ้าไม่อยากใส่ SSH key)

```bash
git clone https://<TOKEN>@github.com/intrawebmis/SyncDBJOB.git /opt/syncdbjob
# หรือกำหนดตอนรันสคริปต์:
sudo REPO=https://<TOKEN>@github.com/intrawebmis/SyncDBJOB.git bash deploy/install.sh
```

เพิ่ม host key ของ GitHub (กัน prompt เวลา clone)

```bash
ssh-keyscan github.com >> ~/.ssh/known_hosts
```

---

## 2. ติดตั้งด้วยสคริปต์ (แนะนำ)

```bash
cd /opt/syncdbjob        # หรือ clone มาเองก่อน
sudo bash deploy/install.sh
```

สคริปต์นี้จะทำให้อัตโนมัติ:

| ขั้น | สิ่งที่ทำ |
|---|---|
| 1/8 | ติดตั้ง nginx, git, build-essential ฯลฯ |
| 2/8 | ติดตั้ง Node.js 22 (ถ้ายังไม่มี) |
| 3/8 | สร้าง user ระบบ `syncdb` (ไม่มี login shell) |
| 4/8 | clone / `git pull` โค้ดจาก GitHub |
| 5/8 | `npm ci` + `npm run build` |
| 6/8 | เตรียม `storage/` + ตรวจไฟล์ `.env` + ตั้งสิทธิ์ไฟล์ |
| 7/8 | ติดตั้ง systemd service (`syncdbjob.service`) |
| 8/8 | ติดตั้ง nginx config + rate limit zone |

> สคริปต์จะ **หยุด** ถ้ายังไม่มีไฟล์ `.env` → ให้แก้ `.env` แล้วรันสคริปต์ซ้ำ

กำหนดค่าเองได้ผ่าน environment variable:

```bash
sudo APP_DIR=/srv/syncdbjob APP_USER=syncdb REPO=git@github.com:intrawebmis/SyncDBJOB.git \
  bash deploy/install.sh
```

---

## 3. ตั้งค่าไฟล์ `.env`

```bash
sudo nano /opt/syncdbjob/.env
```

```bash
# ===== การเชื่อมต่อ MySQL (Remote) =====
DB_HOST=ebcitrade.com
DB_PORT=3306
DB_USER=ebciadmin_ebci
DB_PASSWORD=xxxx
DB_NAME=ebciadmin_ebcitrade2015
DB_SSL=false
DB_DIALECT=auto

# ===== Web UI =====
APP_HOST=127.0.0.1          # ผูกกับ localhost เท่านั้น (nginx เป็นคนเข้ามา)
APP_PORT=3000
APP_TRUST_PROXY=true        # ⚠️ ต้องเป็น true เพราะอยู่หลัง nginx

# ===== ระบบล็อกอิน =====
APP_AUTH_ENABLED=true
AUTH_USERS_TABLE=newfin_users
APP_SESSION_SECRET=         # ว่างไว้ = ระบบสร้างให้เองที่ storage/.session-secret
APP_SESSION_TTL_HOURS=12
APP_LOGIN_MAX_ATTEMPTS=10
APP_LOGIN_LOCK_MINUTES=15

# ===== พฤติกรรมการ Sync =====
SYNC_ON_ERROR=skip
SYNC_BATCH_SIZE=1
CREATE_JOB_LOG_TABLE=true
STORAGE_DIR=storage
LOG_LEVEL=info
```

> 🔑 **`APP_TRUST_PROXY=true` สำคัญมาก** เพราะ:
> - cookie จะได้ flag `Secure` อัตโนมัติเมื่อเข้าผ่าน HTTPS
> - ระบบนับจำนวนครั้งที่ล็อกอินผิดด้วย IP จริง (ไม่ใช่ IP ของ nginx)

---

## 4. ตั้งค่า nginx

```bash
sudo nano /etc/nginx/sites-available/syncdbjob
```

แก้ `server_name` ให้เป็นโดเมนจริง (เช่น `syncdbjob.ebcitrade.com`) และแก้ path ของ SSL ให้ตรงกับ certbot

```bash
sudo nginx -t && sudo systemctl reload nginx
```

ถ้าต้องการ **ไม่ใช้ Basic Auth ของ nginx** (เพราะแอปมี Login อยู่แล้ว) ให้ comment ออก 2 บรรทัดนี้:

```nginx
# auth_basic           "SyncDBJOB";
# auth_basic_user_file /etc/nginx/.htpasswd;
```

แต่ **แนะนำให้เปิดไว้** เป็นชั้นป้องกันซ้ำ (defense in depth)

---

## 5. ตั้งค่า SSL (certbot)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d syncdbjob.ebcitrade.com
```

certbot จะแก้ nginx ให้ redirect HTTP → HTTPS อัตโนมัติ

---

## 6. สร้างบัญชีล็อกอิน

```bash
cd /opt/syncdbjob

# ดูผู้ใช้ที่มีอยู่
sudo -u syncdb npm run dev -- user list

# ถ้ายังไม่มีบัญชี หรือลืมรหัสผ่านเดิม → ตั้งใหม่
sudo -u syncdb npm run dev -- user add -u admin -p 'รหัสผ่านใหม่' -r ADMIN

# เพิ่มผู้ใช้ธรรมดา
sudo -u syncdb npm run dev -- user add -u staff01 -p 'รหัสผ่าน' --full-name 'ชื่อ ทดสอบ'

# ปิดบัญชีที่ไม่ใช้แล้ว
sudo -u syncdb npm run dev -- user enable -u staff01 --disable
```

> ⚠️ คำสั่ง CLI เหล่านี้ **ไม่ต้องล็อกอิน** (รันจาก shell ที่มีสิทธิ์) — ให้จำกัดสิทธิ์ผู้ใช้ `syncdb` และไฟล์ `.env` ไว้

---

## 7. เริ่มและตรวจสอบ Service

```bash
sudo systemctl start syncdbjob
sudo systemctl enable syncdbjob        # เปิดอัตโนมัติตอน reboot
sudo systemctl status syncdbjob

# ดู log
sudo journalctl -u syncdbjob -f
sudo journalctl -u syncdbjob -n 100 --no-pager
```

ทดสอบจากบน host:

```bash
curl http://127.0.0.1:3000/api/health
# ควรได้ {"ok":true,"connected":true,"authEnabled":true,"authenticated":false}
```

ทดสอบจากเครื่องตัวเอง (ต้องผ่าน nginx):

```bash
curl -u admin:รหัสผ่าน http://syncdbjob.ebcitrade.com/api/health
```

เปิดเบราว์เซอร์ → `https://syncdbjob.ebcitrade.com` → ต้องเจอหน้า **เข้าสู่ระบบ**

---

## 7.1 ติดตั้งใต้โฟลเดอร์ย่อย (เช่น `ebcitrade.com/SyncJOB`)

ถ้าต้องการให้แอปอยู่ใต้ path เดียวกับเว็บอื่นในโดเมนเดียวกัน (ไม่ต้องตั้ง subdomain ใหม่)

**1) ตั้งค่าใน `.env`**

```bash
APP_BASE_PATH=/SyncJOB
```

**2) ตั้ง nginx ให้ proxy เฉพาะ path นั้น**

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

# เข้าโดเมนตรง ๆ ให้เด้งไปที่โฟลเดอร์
location = /SyncJOB {
    return 301 /SyncJOB/;
}
```

**3) ตรวจสอบ**

```bash
sudo systemctl restart syncdbjob
curl http://127.0.0.1:3000/SyncJOB/api/health
# ต้องได้ {"ok":true,...}
```

> หน้าเว็บใช้ URL แบบ relative ทั้งหมด → ติดตั้งที่ root หรือใต้ subfolder ได้โดยไม่ต้องแก้โค้ด
> ถ้าเปลี่ยน `APP_BASE_PATH` ภายหลัง ให้เคลียร์ cache ของเบราว์เซอร์ด้วย (redirect ไม่ถูก cache แล้ว)

---

## 8. อัปเดตโค้ด (ครั้งถัดไป)

```bash
cd /opt/syncdbjob
sudo -u syncdb git pull --ff-only origin main
sudo -u syncdb npm ci
sudo -u syncdb npm run build
sudo systemctl restart syncdbjob
```

หรือใช้สคริปต์ครั้งเดียว (ทำ clone/pull + build + service ครบ):

```bash
sudo bash /opt/syncdbjob/deploy/install.sh
```

> `.env` และโฟลเดอร์ `storage/` ไม่ถูกทับตอน `git pull` (อยู่ใน `.gitignore`)

---

## 9. Docker (ทางเลือก)

```bash
git clone git@github.com:intrawebmis/SyncDBJOB.git
cd SyncDBJOB
cp .env.example .env && nano .env

docker compose up -d --build
docker compose logs -f
```

- พอร์ตผูกกับ `127.0.0.1:3000` เท่านั้น → ยังต้องมี nginx หน้าหน้า
- `storage/` ถูก mount เป็น volume → ข้อมูลไม่หายเมื่อ rebuild

---

## 10. ปัญหาที่พบบ่อย

| อาการ | วิธีแก้ |
|---|---|
| `Web UI พร้อมใช้งาน` แต่เข้าเว็บไม่ได้ | `sudo systemctl status syncdbjob` + `journalctl -u syncdbjob -n 50` |
| 502 Bad Gateway | service ยังไม่ start หรือ `.env` ผิด → ดู log |
| Login แล้วเด้งกลับหน้า login | `APP_TRUST_PROXY=true` ยังไม่ได้ตั้ง → cookie `Secure` ไม่ถูกส่งกลับ |
| หน้าเว็บว่าง / 404 | รันจากผิดโฟลเดอร์ — `public/` และ `storage/` อ้างอิง `process.cwd()` → ต้อง `WorkingDirectory=/opt/syncdbjob` (ตั้งใน systemd แล้ว) |
| อัปโหลดไฟล์ใหญ่ไม่ได้ | nginx `client_max_body_size 120M` (ตั้งไว้แล้ว) + multer limit 100MB |
| `EACCES` เขียนไฟล์ไม่ได้ | `sudo chown -R syncdb:syncdb /opt/syncdbjob/storage` |
| ล็อกอินไม่ได้ "ระบบล็อกอินขัดข้อง" | user ของ DB ต้องมีสิทธิ์ `SELECT` ตาราง `newfin_users` |
| session หมดทุกครั้งที่ restart | ตั้ง `APP_SESSION_SECRET` เป็นค่าคงที่ หรือปล่อยให้ระบบสร้างใน `storage/.session-secret` (ต้องอยู่บน volume ที่ไม่ถูกลบ) |

---

## 11. โครงสร้างบน host

```
/opt/syncdbjob/
├── .env                     # ⚠️ chmod 600 — ห้ามหลุดขึ้น Git
├── dist/                    # โค้ดที่ compile แล้ว
├── public/                  # Web UI
├── storage/                 # ⚠️ ต้องอยู่ใน ReadWritePaths ของ systemd
│   ├── .session-secret      # คีย์เซ็น cookie (สร้างอัตโนมัติ)
│   ├── uploads/             # ไฟล์ Excel ที่อัปโหลด
│   ├── mappings/            # mapping ที่บันทึกไว้
│   └── exports/             # ไฟล์ template ที่สร้าง
└── deploy/                  # สคริปต์ติดตั้ง + nginx/systemd config
```

systemd ตั้งค่าความปลอดภัยไว้แล้ว:

```ini
ProtectSystem=strict          # ระบบไฟล์ทั้งหมดเป็น read-only
ReadWritePaths=/opt/syncdbjob/storage   # เขียนได้เฉพาะ storage/
NoNewPrivileges=true
PrivateTmp=true
```

ถ้าต้องการเพิ่มพื้นที่เขียนอื่น ๆ ให้เพิ่ม path ลงใน `ReadWritePaths` ใน `/etc/systemd/system/syncdbjob.service`
