// Installation and push notification plumbing.

import { api, getConfig } from './api.js';
import { store } from './store.js';

let deferredInstall = null;
const installListeners = new Set();

export function initPwa() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    installListeners.forEach((fn) => fn(true));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    installListeners.forEach((fn) => fn(false));
    api('/api/events', { method: 'POST', body: { type: 'installed' } }).catch(() => {});
  });
}

export function canInstall() {
  return Boolean(deferredInstall);
}

export function onInstallAvailable(fn) {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const choice = await deferredInstall.userChoice;
  deferredInstall = null;
  return choice.outcome === 'accepted';
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function pushSupport() {
  const cfg = await getConfig();
  if (!cfg.pushEnabled) return { supported: false, reason: 'Notifications are not enabled on this server.' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (isIos() && !isStandalone()) return { supported: false, reason: 'On iPhone, add CrowdFeed to your home screen first, then notifications become available.' };
    return { supported: false, reason: 'This browser does not support notifications.' };
  }
  return { supported: true, vapidPublicKey: cfg.vapidPublicKey };
}

export async function subscribeToVenue(venueSlug) {
  const support = await pushSupport();
  if (!support.supported) throw new Error(support.reason);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(support.vapidPublicKey) });
  }
  await api('/api/push/subscribe', { method: 'POST', body: { venue: venueSlug, subscription: sub.toJSON() } });
  store.setPushVenue(venueSlug, true);
  return true;
}

export async function unsubscribeAll() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
  for (const slug of Object.keys(store.getPushVenues())) store.setPushVenue(slug, false);
}
