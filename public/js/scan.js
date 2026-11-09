// Staff scanner: reads reward QR codes with the camera and redeems them.

import { startScanner } from './scanner.js';

const pinInput = document.getElementById('pin');
const setup = document.getElementById('setup');
const scanCard = document.getElementById('scan-card');
const video = scanCard.querySelector('video');
const status = document.getElementById('status');
const result = document.getElementById('result');
let stop = null;
let busy = false;

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function loadSettings() {
  const params = new URLSearchParams(location.search);
  const venue = params.get('venue');
  if (venue) {
    const note = document.getElementById('venue-note');
    note.textContent = `Scanner opened for venue "${venue}". Coupons from other venues are refused by their own PIN.`;
    note.hidden = false;
  }
  const savedPin = sessionStorage.getItem('cf.staff.pin');
  if (savedPin) pinInput.value = savedPin;
}

function showResult(ok, title, detail) {
  result.innerHTML = `<div class="result-big ${ok ? 'ok' : 'bad'}">${esc(title)}${detail ? `<div class="small" style="font-weight:400;margin-top:6px">${esc(detail)}</div>` : ''}</div>`;
  if (navigator.vibrate) navigator.vibrate(ok ? [60] : [40, 60, 40]);
}

async function redeem(token) {
  if (busy) return;
  busy = true;
  status.textContent = 'Checking the coupon';
  try {
    const r = await fetch('/api/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, pin: pinInput.value })
    });
    const data = await r.json();
    if (data.ok) showResult(true, `Give: ${data.reward}`, `${data.venue}. Marked as used.`);
    else if (r.status === 401) showResult(false, 'Wrong PIN for this venue', data.error);
    else showResult(false, data.message || data.error || 'Not accepted', data.venue ? `${data.venue}, ${data.reward || ''}` : '');
  } catch {
    showResult(false, 'Network problem', 'Check the connection and try again.');
  } finally {
    busy = false;
    status.textContent = 'Ready for the next code.';
    setTimeout(startCamera, 1800);
  }
}

async function startCamera() {
  if (stop) stop();
  stop = await startScanner(
    video,
    (text) => {
      stop = null;
      redeem(text);
    },
    (err) => {
      status.textContent = err.message;
    }
  );
}

setup.addEventListener('submit', (e) => {
  e.preventDefault();
  sessionStorage.setItem('cf.staff.pin', pinInput.value);
  setup.parentElement.hidden = true;
  scanCard.hidden = false;
  startCamera();
});

document.getElementById('manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = document.getElementById('manual-code').value.trim();
  if (code) redeem(code);
  document.getElementById('manual-code').value = '';
});

document.getElementById('change').addEventListener('click', () => {
  if (stop) stop();
  stop = null;
  scanCard.hidden = true;
  setup.parentElement.hidden = false;
});

loadSettings();
