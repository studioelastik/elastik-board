import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST || '0.0.0.0',
  root: path.resolve(here, '..'),
  publicDir: path.resolve(here, '..', 'public'),
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(here, '..', 'data'),

  // Shared password for the UI + API. Empty = no auth (only safe on localhost
  // or behind Tailscale/a reverse proxy that already authenticates).
  accessToken: process.env.AGENT_TOKEN || '',

  // Polling. Willhaben is a free service being scraped for personal use —
  // keep the floor high enough that we look like a person refreshing a tab.
  defaultIntervalSec: num(process.env.POLL_INTERVAL_SEC, 60),
  minIntervalSec: num(process.env.MIN_POLL_INTERVAL_SEC, 20),
  // Never let two outbound requests land closer together than this, no matter
  // how many searches are configured.
  minRequestSpacingMs: num(process.env.MIN_REQUEST_SPACING_MS, 2500),
  requestTimeoutMs: num(process.env.REQUEST_TIMEOUT_MS, 20000),

  // How many adverts we remember per search before forgetting the oldest.
  seenCap: num(process.env.SEEN_CAP, 3000),
  // Size of the shared "recent finds" feed shown in the UI.
  hitsCap: num(process.env.HITS_CAP, 300),
  // Safety valve: if a poll suddenly reports more new items than this, treat it
  // as a re-seed (willhaben changed IDs / we got a different result set) and
  // notify about a capped sample instead of spamming.
  maxNotificationsPerPoll: num(process.env.MAX_NOTIFICATIONS_PER_POLL, 5),

  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:agent@example.com',
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || ''
};

export const USER_AGENT =
  process.env.WILLHABEN_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
