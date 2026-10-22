#!/usr/bin/env bash
# ==========================================================
#  SyncDBJOB — ติดตั้งบน Ubuntu/Debian Server (22.04 / 24.04)
#  ใช้งาน: sudo bash deploy/install.sh
# ==========================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/syncdbjob}"
APP_USER="${APP_USER:-syncdb}"
REPO="${REPO:-git@github.com:intrawebmis/SyncDBJOB.git}"
BRANCH="${BRANCH:-main}"
NODE_MAJOR="22"

echo "==> [1/8] ติดตั้งแพ็กเกจพื้นฐาน"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git nginx build-essential python3

echo "==> [2/8] ติดตั้ง Node.js ${NODE_MAJOR}.x"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt "$NODE_MAJOR" ]; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
    apt-get install -y -qq nodejs
fi
node -v && npm -v

echo "==> [3/8] สร้างผู้ใช้ระบบ '${APP_USER}' (ไม่มี login shell)"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "/home/${APP_USER}" --shell /usr/sbin/nologin "$APP_USER"
fi

echo "==> [4/8] ดึงโค้ดจาก GitHub"
if [ -d "${APP_DIR}/.git" ]; then
    cd "$APP_DIR" && git pull --ff-only origin "$BRANCH"
else
    mkdir -p "$APP_DIR"
    # ใช้ SSH key ของ host หรือ https แทนก็ได้:
    # git clone https://github.com/intrawebmis/SyncDBJOB.git "$APP_DIR"
    git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

echo "==> [5/8] ติดตั้ง dependencies และ build"
npm ci
npm run build

echo "==> [6/8] เตรียมโฟลเดอร์ storage"
mkdir -p storage/uploads storage/mappings
touch storage/uploads/.gitkeep storage/mappings/.gitkeep

if [ ! -f .env ]; then
    cp .env.example .env
    chmod 600 .env
    echo ""
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo " ! ต้องแก้ไฟล์ .env ให้ชี้ไปที่ฐานข้อมูลจริงก่อน!"
    echo " !   nano $APP_DIR/.env"
    echo " !   แล้วรันซ้ำ: sudo bash $APP_DIR/deploy/install.sh"
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo ""
    exit 1
fi
chmod 600 .env

echo "==> [7/8] ติดตั้ง systemd service"
cp deploy/syncdbjob.service /etc/systemd/system/syncdbjob.service
sed -i "s#/opt/syncdbjob#${APP_DIR}#g" /etc/systemd/system/syncdbjob.service
systemctl daemon-reload
systemctl enable syncdbjob

echo "==> [8/8] ติดตั้ง nginx (ยังไม่เปิดใช้จนกว่าจะตั้งค่าโดเมน/SSL)"
cp deploy/nginx-limit.conf /etc/nginx/conf.d/syncdbjob-limit.conf
if [ ! -L /etc/nginx/sites-enabled/syncdbjob ]; then
    cp deploy/nginx.conf /etc/nginx/sites-available/syncdbjob
    ln -s /etc/nginx/sites-available/syncdbjob /etc/nginx/sites-enabled/syncdbjob
fi
rm -f /etc/nginx/sites-enabled/default

echo ""
echo "=========================================================="
echo " ติดตั้งเสร็จแล้ว!"
echo ""
echo " ขั้นตอนต่อไป:"
echo "  1) แก้ .env      : sudo nano ${APP_DIR}/.env"
echo "  2) แก้โดเมนใน nginx: sudo nano /etc/nginx/sites-available/syncdbjob"
echo "  3) สร้างรหัสผ่าน : sudo htpasswd -c /etc/nginx/.htpasswd admin"
echo "  4) ทดสอบระบบ    : cd ${APP_DIR} && npm run dev -- check"
echo "  5) เริ่ม service  : sudo systemctl start syncdbjob"
echo "  6) ตรวจสถานะ     : sudo systemctl status syncdbjob"
echo "  7) ขอ SSL cert   : sudo certbot --nginx -d example.com"
echo "  8) ทดสอบจากเครื่องตัวเอง: curl -u admin http://127.0.0.1:3000/api/health"
echo "=========================================================="
