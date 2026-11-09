// Web Push to subscribed phones. Subscriptions belong to a venue, so a venue
// can invite the people who opted in when a reward survey is open.

import * as webPush from 'web-push';
import { config } from './config.js';
import { db, now } from './db.js';

export const pushEnabled = Boolean(config.vapidPublicKey && config.vapidPrivateKey);

if (pushEnabled) {
  webPush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
}

export async function saveSubscription(venueId, subscription) {
  const { endpoint, keys } = subscription || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) throw new Error('Incomplete subscription');
  await db.run(
    `INSERT INTO push_subscriptions (venue_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET venue_id = excluded.venue_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [venueId, endpoint, keys.p256dh, keys.auth, now()]
  );
}

export async function removeSubscription(endpoint) {
  await db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
}

export async function sendToVenue(venueId, payload) {
  if (!pushEnabled) return { sent: 0, failed: 0, removed: 0, disabled: true };
  const subs = await db.all('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE venue_id = ?', [venueId]);
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  let removed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webPush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600 });
        sent += 1;
        await db.run('UPDATE push_subscriptions SET last_sent_at = ? WHERE id = ?', [now(), s.id]);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          removed += 1;
          await db.run('DELETE FROM push_subscriptions WHERE id = ?', [s.id]);
        } else {
          failed += 1;
        }
      }
    })
  );
  return { sent, failed, removed, disabled: false };
}
