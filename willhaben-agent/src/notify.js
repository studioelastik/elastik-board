import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { config } from './config.js';
import { getDb, removeSubscription } from './store.js';

let vapid = null;

/**
 * VAPID keys identify this server to the browser push services. They must stay
 * stable — regenerating them invalidates every existing subscription — so we
 * persist a generated pair next to the database unless the env supplies one.
 */
export function initPush() {
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    vapid = { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
  } else {
    const file = path.join(config.dataDir, 'vapid.json');
    fs.mkdirSync(config.dataDir, { recursive: true });
    if (fs.existsSync(file)) {
      vapid = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      vapid = webpush.generateVAPIDKeys();
      fs.writeFileSync(file, JSON.stringify(vapid, null, 2));
      console.log(`[push] generated a VAPID key pair → ${file} (keep this file; deleting it logs every device out)`);
    }
  }
  webpush.setVapidDetails(config.vapidSubject, vapid.publicKey, vapid.privateKey);
  return vapid;
}

export const publicKey = () => vapid?.publicKey || '';

async function sendWebPush(payload) {
  const db = getDb();
  const dead = [];
  await Promise.all(
    db.subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
          { TTL: 600, urgency: 'high' }
        );
      } catch (err) {
        // 404/410 mean the browser threw the subscription away for good.
        if (err.statusCode === 404 || err.statusCode === 410) dead.push(sub.endpoint);
        else console.error('[push] send failed:', err.statusCode || '', err.message);
      }
    })
  );
  for (const endpoint of dead) removeSubscription(endpoint);
  return db.subscriptions.length;
}

async function sendTelegram(text, url) {
  const { telegram } = getDb().settings;
  if (!telegram?.enabled || !telegram.botToken || !telegram.chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegram.chatId,
        text: url ? `${text}\n${url}` : text,
        disable_web_page_preview: false
      })
    });
    if (!res.ok) console.error('[telegram] HTTP', res.status, (await res.text()).slice(0, 200));
  } catch (err) {
    console.error('[telegram] failed:', err.message);
  }
}

async function sendWebhook(payload) {
  const { webhook } = getDb().settings;
  if (!webhook?.enabled || !webhook.url) return;
  try {
    // `text` mode is what ntfy.sh and friends expect; `json` suits Discord-ish
    // and homemade endpoints.
    const isText = webhook.format === 'text';
    await fetch(webhook.url, {
      method: 'POST',
      headers: isText
        ? { 'content-type': 'text/plain', Title: payload.title, Click: payload.url || '' }
        : { 'content-type': 'application/json' },
      body: isText ? `${payload.body}\n${payload.url || ''}` : JSON.stringify(payload)
    });
  } catch (err) {
    console.error('[webhook] failed:', err.message);
  }
}

/** Fan a single notification out over every channel that is switched on. */
export async function notify({ title, body, url, tag, image }) {
  const payload = { title, body, url: url || null, tag: tag || 'willhaben', image: image || null, ts: Date.now() };
  await Promise.all([sendWebPush(payload), sendTelegram(`${title}\n${body}`, url), sendWebhook(payload)]);
}

export function notifyForItem(item, search) {
  const price = item.priceText || (item.price != null ? `€ ${item.price.toLocaleString('de-AT')}` : 'Preis auf Anfrage');
  const where = [item.postcode, item.location].filter(Boolean).join(' ');
  return notify({
    title: item.title.slice(0, 90),
    body: [price, where, `· ${search.name}`].filter(Boolean).join('  ·  '),
    url: item.url,
    image: item.image,
    tag: `wh-${item.id}`
  });
}

export function notifySummary(count, search) {
  return notify({
    title: `${count} new on willhaben`,
    body: `${search.name} — open the agent to see them all.`,
    tag: `wh-sum-${search.id}-${Date.now()}`
  });
}
