import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { getDb, markSeen, recordHits, save } from './store.js';
import { matches } from './filters.js';
import { runSearch, WillhabenError } from './willhaben.js';
import { notifyForItem, notifySummary, notify } from './notify.js';

export const bus = new EventEmitter();

let running = false;
let tickTimer = null;
let lastRequestAt = 0;
const inFlight = new Set();

const jitter = (ms) => ms * (0.85 + Math.random() * 0.3);

/** Exponential backoff after failures, capped at 15 minutes. */
function backoffMs(search) {
  const n = Math.min(search.consecutiveErrors || 0, 6);
  if (n === 0) return 0;
  return Math.min(15 * 60_000, 1000 * 2 ** (n + 3)); // 16s, 32s, 64s … 15m
}

function dueAt(search) {
  const base = (search.lastRunAt || 0) + search.intervalSec * 1000;
  return Math.max(base, (search.lastRunAt || 0) + backoffMs(search));
}

/** One poll of one search: fetch, diff against `seen`, notify on what's new. */
export async function pollSearch(search, { manual = false } = {}) {
  if (inFlight.has(search.id)) return { skipped: 'already running' };
  inFlight.add(search.id);

  // Global spacing so N searches never turn into N simultaneous requests.
  const wait = lastRequestAt + config.minRequestSpacingMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  search.lastRunAt = Date.now();
  search.stats.polls++;

  try {
    const { items, strategy, rowsFound } = await runSearch(search.url);

    search.lastOkAt = Date.now();
    search.lastError = null;
    search.consecutiveErrors = 0;
    search.lastCount = items.length;
    search.lastStrategy = strategy;
    search.rowsFound = rowsFound;

    const fresh = items.filter((i) => !search._seenSet.has(i.id));

    if (!search.seeded) {
      // First run: learn the current state of the world silently. Without this
      // you'd get 25 notifications the moment you add a search.
      markSeen(search, items.map((i) => i.id));
      search.seeded = true;
      save();
      bus.emit('event', { type: 'seeded', searchId: search.id, count: items.length });
      return { seeded: true, count: items.length, new: 0 };
    }

    markSeen(search, items.map((i) => i.id));

    const hits = fresh.filter((i) => matches(i, search.filters));
    if (hits.length) {
      search.stats.found += hits.length;
      recordHits(search, hits);
      bus.emit('event', { type: 'hits', searchId: search.id, items: hits });

      if (hits.length > config.maxNotificationsPerPoll) {
        await notifySummary(hits.length, search);
      } else {
        // Oldest first, so the newest advert is the notification on top.
        for (const item of [...hits].reverse()) await notifyForItem(item, search);
      }
    }
    save();
    bus.emit('event', { type: 'polled', searchId: search.id, count: items.length, new: hits.length, manual });
    return { count: items.length, new: hits.length, filteredOut: fresh.length - hits.length };
  } catch (err) {
    search.consecutiveErrors = (search.consecutiveErrors || 0) + 1;
    search.stats.errors++;
    search.lastError = {
      message: err.message,
      kind: err instanceof WillhabenError ? err.kind : 'unknown',
      at: Date.now()
    };
    save();
    bus.emit('event', { type: 'error', searchId: search.id, error: search.lastError });

    // Tell the user once when a search goes properly dark, not on every retry.
    if (getDb().settings.notifyOnError && search.consecutiveErrors === 3) {
      await notify({
        title: `Search "${search.name}" is failing`,
        body: err.message.slice(0, 160),
        tag: `wh-err-${search.id}`
      }).catch(() => {});
    }
    return { error: search.lastError };
  } finally {
    inFlight.delete(search.id);
  }
}

function tick() {
  const now = Date.now();
  for (const search of getDb().searches) {
    if (!search.enabled) continue;
    if (inFlight.has(search.id)) continue;
    if (dueAt(search) > now) continue;
    pollSearch(search).catch((err) => console.error('[poller]', err));
  }
  tickTimer = setTimeout(tick, jitter(5000));
}

export function start() {
  if (running) return;
  running = true;
  tickTimer = setTimeout(tick, 1500);
  console.log('[poller] started');
}

export function stop() {
  running = false;
  if (tickTimer) clearTimeout(tickTimer);
}

export const nextRunAt = (search) => (search.enabled ? dueAt(search) : null);
export const isRunning = (id) => inFlight.has(id);
