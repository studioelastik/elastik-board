import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import * as store from './store.js';
import { initPush, publicKey, notify } from './notify.js';
import * as poller from './poller.js';
import { normaliseSearchUrl, runSearch, WillhabenError } from './willhaben.js';
import { describeFilters } from './filters.js';

store.load();
initPush();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
  });
  res.end(payload);
};

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Invalid JSON body');
  }
}

// ── auth ────────────────────────────────────────────────────────────────────

function tokenFrom(req, url) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const q = url.searchParams.get('token');
  if (q) return q;
  const cookie = /(?:^|;\s*)wh_token=([^;]+)/.exec(req.headers.cookie || '');
  return cookie ? decodeURIComponent(cookie[1]) : '';
}

function authorised(req, url) {
  if (!config.accessToken) return true;
  const given = tokenFrom(req, url);
  const a = Buffer.from(given || '');
  const b = Buffer.from(config.accessToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── SSE ─────────────────────────────────────────────────────────────────────

const sseClients = new Set();

poller.bus.on('event', (event) => {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(frame);
});

setInterval(() => {
  for (const res of sseClients) res.write(': ping\n\n');
}, 25_000).unref();

// ── view model ──────────────────────────────────────────────────────────────

const publicSearch = (s) => ({
  id: s.id,
  name: s.name,
  url: s.url,
  enabled: s.enabled,
  intervalSec: s.intervalSec,
  filters: s.filters,
  filtersLabel: describeFilters(s.filters),
  seeded: s.seeded,
  seenCount: s.seen.length,
  lastRunAt: s.lastRunAt,
  lastOkAt: s.lastOkAt,
  lastError: s.lastError,
  lastCount: s.lastCount,
  lastStrategy: s.lastStrategy || null,
  rowsFound: s.rowsFound ?? null,
  stats: s.stats,
  nextRunAt: poller.nextRunAt(s),
  running: poller.isRunning(s.id)
});

function state() {
  const db = store.getDb();
  return {
    searches: db.searches.map(publicSearch),
    hits: db.hits,
    settings: {
      ...db.settings,
      // Never hand secrets back to the browser; just say whether one is set.
      telegram: { ...db.settings.telegram, botToken: db.settings.telegram.botToken ? '••••••••' : '' }
    },
    subscriptions: db.subscriptions.length,
    vapidPublicKey: publicKey(),
    config: { minIntervalSec: config.minIntervalSec, defaultIntervalSec: config.defaultIntervalSec }
  };
}

// ── static files ────────────────────────────────────────────────────────────

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(config.publicDir, rel);
  if (!file.startsWith(config.publicDir)) return json(res, 403, { error: 'Forbidden' });
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      // The service worker has to be allowed to control the whole origin.
      ...(rel === 'sw.js' ? { 'service-worker-allowed': '/' } : {})
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}

// ── routing ─────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;
  const method = req.method || 'GET';

  try {
    // The shell and the login screen must load before there is a token.
    const isOpen =
      pathname === '/' ||
      pathname === '/index.html' ||
      pathname === '/app.js' ||
      pathname === '/styles.css' ||
      pathname === '/sw.js' ||
      pathname === '/manifest.json' ||
      pathname === '/api/auth-required' ||
      pathname.startsWith('/icon');

    if (!isOpen && !authorised(req, url)) return json(res, 401, { error: 'Unauthorized' });

    if (pathname === '/api/auth-required' && method === 'GET') {
      return json(res, 200, { required: !!config.accessToken });
    }

    if (pathname === '/api/state' && method === 'GET') return json(res, 200, state());

    if (pathname === '/api/events' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      });
      res.write('retry: 3000\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (pathname === '/api/searches' && method === 'POST') {
      const body = await readBody(req);
      const normalisedUrl = normaliseSearchUrl(body.url);
      const search = store.addSearch({ ...body, url: normalisedUrl });
      // Seed immediately so the search is armed within seconds, not a minute.
      poller.pollSearch(search).catch(() => {});
      return json(res, 201, publicSearch(search));
    }

    const searchMatch = /^\/api\/searches\/([\w-]+)(\/run)?$/.exec(pathname);
    if (searchMatch) {
      const [, id, runSuffix] = searchMatch;
      const search = store.getDb().searches.find((s) => s.id === id);
      if (!search) return json(res, 404, { error: 'No such search' });

      if (runSuffix && method === 'POST') {
        const result = await poller.pollSearch(search, { manual: true });
        return json(res, 200, { result, search: publicSearch(search) });
      }
      if (method === 'PATCH') {
        const body = await readBody(req);
        if (body.url) body.url = normaliseSearchUrl(body.url);
        const updated = store.updateSearch(id, body);
        if (updated && !updated.seeded && updated.enabled) poller.pollSearch(updated).catch(() => {});
        return json(res, 200, publicSearch(updated));
      }
      if (method === 'DELETE') {
        store.removeSearch(id);
        return json(res, 200, { ok: true });
      }
    }

    if (pathname === '/api/preview' && method === 'POST') {
      const body = await readBody(req);
      const normalisedUrl = normaliseSearchUrl(body.url);
      const { items, strategy, rowsFound } = await runSearch(normalisedUrl);
      return json(res, 200, { url: normalisedUrl, strategy, rowsFound, count: items.length, items: items.slice(0, 6) });
    }

    if (pathname === '/api/subscribe' && method === 'POST') {
      const body = await readBody(req);
      if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
        return json(res, 400, { error: 'Not a valid push subscription' });
      }
      store.addSubscription(body, req.headers['user-agent']);
      return json(res, 200, { ok: true, subscriptions: store.getDb().subscriptions.length });
    }

    if (pathname === '/api/unsubscribe' && method === 'POST') {
      const body = await readBody(req);
      store.removeSubscription(body.endpoint);
      return json(res, 200, { ok: true, subscriptions: store.getDb().subscriptions.length });
    }

    if (pathname === '/api/test-notification' && method === 'POST') {
      await notify({
        title: 'willhaben agent',
        body: 'Notifications are working. This is what a new advert will look like.',
        url: 'https://www.willhaben.at/',
        tag: 'wh-test'
      });
      return json(res, 200, { ok: true, subscriptions: store.getDb().subscriptions.length });
    }

    if (pathname === '/api/settings' && method === 'POST') {
      const body = await readBody(req);
      // A masked token coming back from the UI means "leave it alone".
      if (body.telegram && /^•+$/.test(body.telegram.botToken || '')) delete body.telegram.botToken;
      store.updateSettings(body);
      return json(res, 200, state().settings);
    }

    if (pathname === '/api/hits' && method === 'DELETE') {
      store.getDb().hits = [];
      store.save();
      return json(res, 200, { ok: true });
    }

    if (method === 'GET' || method === 'HEAD') return serveStatic(req, res, pathname);
    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    const status = err instanceof WillhabenError ? (err.kind === 'parse' ? 400 : 502) : 400;
    return json(res, status, { error: err.message, kind: err.kind || 'error' });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`\n  willhaben agent → http://localhost:${config.port}`);
  console.log(`  data            → ${config.dataDir}`);
  console.log(`  auth            → ${config.accessToken ? 'token required' : 'OPEN (set AGENT_TOKEN before exposing this)'}`);
  console.log(`  searches        → ${store.getDb().searches.length}\n`);
  poller.start();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\nshutting down…');
    poller.stop();
    store.flushSync();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
