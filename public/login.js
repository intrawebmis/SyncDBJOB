/* SyncDBJOB — สคริปต์หน้าเข้าสู่ระบบ (ไม่ต้อง build) */
'use strict';

const $ = (id) => document.getElementById(id);

const form = $('loginForm');
const msg = $('msg');
const btn = $('btnLogin');

function showError(text) {
  msg.textContent = text;
  msg.className = 'msg';
  msg.hidden = false;
}

/* ถ้าระบบปิดการล็อกอินไว้ (APP_AUTH_ENABLED=false) ให้ข้ามหน้านี้ไปเลย */
async function checkAuthEnabled() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      if (data.authEnabled === false) {
        window.location.replace('/');
        return true;
      }
    }
  } catch {
    /* เครือข่ายมีปัญหา — แสดงหน้าเข้าสู่ระบบตามปกติ */
  }
  return false;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  btn.disabled = true;
  btn.textContent = 'กำลังตรวจสอบ…';
  msg.hidden = true;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: $('username').value.trim(),
        password: $('password').value,
      }),
    });

    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text };
    }

    if (!res.ok || data.ok === false) {
      showError(data.error || `เข้าสู่ระบบไม่สำเร็จ (HTTP ${res.status})`);
      $('password').value = '';
      $('password').focus();
      return;
    }

    window.location.replace('/');
  } catch (err) {
    showError('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'เข้าสู่ระบบ';
  }
});

checkAuthEnabled();
