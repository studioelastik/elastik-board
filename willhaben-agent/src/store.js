import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const DB_FILE = path.join(config.dataDir, 'db.json');
const TMP_FILE = DB_FILE + '.tmp';

const emptyDb = () => ({
  version: 1,
  searches: [],
  subscriptions: [],
  hits: [],
  settings: {
    telegram: { enabled: false, botToken: '', chatId: '' },
    webhook: { enabled: false, url: '', format: 'json' },
    notifyOnError: true
  }
});

let db = emptyDb();
let writeTimer = null;
let writing = null;

export const newId = () => crypto.randomBytes(9).toString('base64url');

export function load() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = { ...emptyDb(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
    } catch (err) {
      // A truncated write should not cost the user their whole config.
      const backup = DB_FILE + '.corrupt-' + Date.now();
      fs.copyFileSync(DB_FILE, backup);
      console.error(`[store] db.json unreadable (${err.message}); moved aside to ${backup}`);
      db = emptyDb();
    }
  }
  for (const s of db.searches) hydrateSearch(s);
  return db;
}

function hydrateSearch(s) {
  s.seen ||= [];
  s._seenSet = new Set(s.seen);
  s.stats ||= { polls: 0, errors: 0, found: 0 };
  return s;
}

export const getDb = () => db;

/** Debounced atomic save. Multiple mutations in one tick cost one write. */
export function save() {
  if (writeTimer) return writing;
  writing = new Promise((resolve) => {
    writeTimer = setTimeout(async () => {
      writeTimer = null;
      try {
        await flush();
      } catch (err) {
        console.error('[store] save failed:', err.message);
      }
      resolve();
    }, 250);
  });
  return writing;
}

export async function flush() {
  const serialisable = {
    ...db,
    searches: db.searches.map(({ _seenSet, ...rest }) => rest)
  };
  await fsp.mkdir(config.dataDir, { recursive: true });
  await fsp.writeFile(TMP_FILE, JSON.stringify(serialisable, null, 2));
  await fsp.rename(TMP_FILE, DB_FILE);
}

export function flushSync() {
  try {
    const serialisable = {
      ...db,
      searches: db.searches.map(({ _seenSet, ...rest }) => rest)
    };
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(TMP_FILE, JSON.stringify(serialisable, null, 2));
    fs.renameSync(TMP_FILE, DB_FILE);
  } catch (err) {
    console.error('[store] final flush failed:', err.message);
  }
}

// ── searches ────────────────────────────────────────────────────────────────

export function addSearch(fields) {
  const search = hydrateSearch({
    id: newId(),
    name: fields.name || 'Unnamed search',
    url: fields.url,
    enabled: fields.enabled !== false,
    intervalSec: Math.max(config.minIntervalSec, fields.intervalSec || config.defaultIntervalSec),
    filters: normaliseFilters(fields.filters),
    seeded: false,
    seen: [],
    createdAt: Date.now(),
    lastRunAt: null,
    lastOkAt: null,
    lastError: null,
    lastCount: 0,
    consecutiveErrors: 0,
    stats: { polls: 0, errors: 0, found: 0 }
  });
  db.searches.push(search);
  save();
  return search;
}

export function normaliseFilters(f = {}) {
  const words = (v) =>
    (Array.isArray(v) ? v : String(v || '').split(','))
      .map((w) => String(w).trim().toLowerCase())
      .filter(Boolean);
  return {
    minPrice: f.minPrice === '' || f.minPrice == null ? null : Number(f.minPrice),
    maxPrice: f.maxPrice === '' || f.maxPrice == null ? null : Number(f.maxPrice),
    include: words(f.include),
    exclude: words(f.exclude),
    sellerType: ['any', 'private', 'dealer'].includes(f.sellerType) ? f.sellerType : 'any'
  };
}

export function updateSearch(id, patch) {
  const s = db.searches.find((x) => x.id === id);
  if (!s) return null;
  if (patch.name != null) s.name = String(patch.name);
  if (patch.url != null && patch.url !== s.url) {
    s.url = String(patch.url);
    // A different query means a different result set — re-seed rather than
    // firing a notification for every advert the new query happens to return.
    s.seeded = false;
    s.seen = [];
    s._seenSet = new Set();
  }
  if (patch.enabled != null) s.enabled = !!patch.enabled;
  if (patch.intervalSec != null) {
    s.intervalSec = Math.max(config.minIntervalSec, Number(patch.intervalSec) || config.defaultIntervalSec);
  }
  if (patch.filters) s.filters = normaliseFilters(patch.filters);
  save();
  return s;
}

export function removeSearch(id) {
  const i = db.searches.findIndex((x) => x.id === id);
  if (i === -1) return false;
  db.searches.splice(i, 1);
  db.hits = db.hits.filter((h) => h.searchId !== id);
  save();
  return true;
}

export function markSeen(search, ids) {
  for (const id of ids) {
    if (search._seenSet.has(id)) continue;
    search._seenSet.add(id);
    search.seen.push(id);
  }
  const overflow = search.seen.length - config.seenCap;
  if (overflow > 0) {
    for (const id of search.seen.splice(0, overflow)) search._seenSet.delete(id);
  }
}

// ── hits feed ───────────────────────────────────────────────────────────────

export function recordHits(search, items) {
  for (const item of items) {
    db.hits.unshift({ ...item, searchId: search.id, searchName: search.name, foundAt: Date.now() });
  }
  if (db.hits.length > config.hitsCap) db.hits.length = config.hitsCap;
  save();
}

// ── push subscriptions ──────────────────────────────────────────────────────

export function addSubscription(sub, ua) {
  const existing = db.subscriptions.find((s) => s.endpoint === sub.endpoint);
  if (existing) {
    existing.keys = sub.keys;
    existing.seenAt = Date.now();
    save();
    return existing;
  }
  const row = {
    id: newId(),
    endpoint: sub.endpoint,
    keys: sub.keys,
    ua: (ua || '').slice(0, 200),
    createdAt: Date.now(),
    seenAt: Date.now()
  };
  db.subscriptions.push(row);
  save();
  return row;
}

export function removeSubscription(endpoint) {
  const before = db.subscriptions.length;
  db.subscriptions = db.subscriptions.filter((s) => s.endpoint !== endpoint);
  if (db.subscriptions.length !== before) save();
  return before !== db.subscriptions.length;
}

export function updateSettings(patch) {
  const s = db.settings;
  if (patch.telegram) s.telegram = { ...s.telegram, ...patch.telegram };
  if (patch.webhook) s.webhook = { ...s.webhook, ...patch.webhook };
  if (patch.notifyOnError != null) s.notifyOnError = !!patch.notifyOnError;
  save();
  return s;
}
