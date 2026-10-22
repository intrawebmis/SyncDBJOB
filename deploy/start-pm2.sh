#!/usr/bin/env bash
# ==========================================================
#  SyncDBJOB — สตาร์ทแอปบนโฮสติ้งที่ไม่มี systemd (เช่น DirectAdmin / cPanel)
#  ใช้ pm2 จัดการโปรเซส
#
#  ใช้งาน:  bash deploy/start-pm2.sh
#  ตัวเลือก:
#    APP_DIR   — โฟลเดอร์แอป (ค่าเริ่มต้น: โฟลเดอร์ปัจจุบัน)
#    PORT      — พอร์ต (ค่าเริ่มต้น: อ่านจาก .env หรือ 3000)
#    NAME      — ชื่อ process ใน pm2 (ค่าเริ่มต้น: syncdbjob)
# ==========================================================
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
NAME="${NAME:-syncdbjob}"

cd "$APP_DIR"

if [ ! -f .env ]; then
    echo "!! ไม่พบไฟล์ .env — สร้างจาก .env.example ก่อน"
    exit 1
fi

# --- หา node ที่ใช้ได้ ---
if ! command -v node >/dev/null 2>&1; then
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
        echo "==> ใช้ Node.js จาก nvm"
        export NVM_DIR="$HOME/.nvm"
        # shellcheck disable=SC1091
        . "$NVM_DIR/nvm.sh"
        nvm use default >/dev/null 2>&1 || nvm use 22 >/dev/null 2>&1 || true
    fi
fi

if ! command -v node >/dev/null 2>&1; then
    echo "!! ไม่พบคำสั่ง node — ติดตั้ง Node.js 22 ก่อน (ดู deploy/README-directadmin.md ข้อ 3)"
    exit 1
fi

NODE_BIN="$(command -v node)"
echo "==> node: $NODE_BIN ($(node -v))"

# --- ติดตั้ง dependencies + build (ถ้ายังไม่ได้ build) ---
if [ ! -f dist/cli.js ]; then
    echo "==> ยังไม่ได้ build — กำลังติดตั้งและ build"
    npm ci
    npm run build
fi

mkdir -p storage/uploads storage/mappings storage/exports

# --- ติดตั้ง pm2 ---
if ! command -v pm2 >/dev/null 2>&1; then
    echo "==> กำลังติดตั้ง pm2"
    npm install -g pm2
fi

# --- เริ่ม / รีสตาร์ทโปรเซส ---
if pm2 describe "$NAME" >/dev/null 2>&1; then
    echo "==> พบ process '$NAME' เดิมแล้ว — กำลังรีสตาร์ท"
    pm2 restart "$NAME" --update-env
else
    echo "==> กำลังเริ่ม process '$NAME'"
    pm2 start "$NODE_BIN" --name "$NAME" -- dist/cli.js serve
fi

pm2 save

PORT_TO_CHECK="$(grep -E '^APP_PORT=' .env | cut -d= -f2 | tr -d '[:space:]' || true)"
PORT_TO_CHECK="${PORT_TO_CHECK:-3000}"
BASE_PATH="$(grep -E '^APP_BASE_PATH=' .env | cut -d= -f2 | tr -d '[:space:]' || true)"

echo ""
echo "==> ตรวจสอบสุขภาพ"
sleep 2
curl -fsS "http://127.0.0.1:${PORT_TO_CHECK}${BASE_PATH}/api/health" && echo "" || echo "!! ยังไม่ตอบ — ดู log ด้วย: pm2 logs $NAME"

echo ""
echo "เสร็จแล้ว — ดูสถานะด้วย:  pm2 list  |  pm2 logs $NAME"
