/**
 * Fetching and parsing willhaben.at search result pages.
 *
 * Willhaben is a Next.js app, so every server-rendered search page ships its
 * full result set as JSON inside a <script id="__NEXT_DATA__"> tag. That is far
 * more stable than scraping the DOM — but the *shape* of that JSON has moved
 * around over the years and differs per vertical (marktplatz / immo / auto).
 * So instead of hard-coding a path like
 *   props.pageProps.searchResult.advertSummaryList.advertSummary
 * we walk the whole blob and pick the array that looks most like a list of
 * adverts. That path is checked first as a fast lane; the walk is the fallback.
 */

import { USER_AGENT, config } from './config.js';

export class WillhabenError extends Error {
  constructor(message, kind = 'unknown', status = 0) {
    super(message);
    this.kind = kind; // 'network' | 'http' | 'blocked' | 'parse' | 'unknown'
    this.status = status;
  }
}

const IMAGE_HOST = 'https://cache.willhaben.at/mmo';

// ── URL handling ────────────────────────────────────────────────────────────

/**
 * Accepts anything the user pastes out of the address bar and returns a URL we
 * are willing to poll: willhaben only, always page 1, sorted newest-first
 * unless the user explicitly chose a sort themselves.
 */
export function normaliseSearchUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new WillhabenError('That does not look like a URL.', 'parse');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new WillhabenError('Only http(s) URLs are supported.', 'parse');
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  // The escape hatch exists so the test suite can point the poller at a local
  // stand-in for willhaben. Never set it in normal operation.
  if (host !== 'willhaben.at' && process.env.WILLHABEN_ALLOW_ANY_HOST !== '1') {
    throw new WillhabenError('Only willhaben.at URLs are supported.', 'parse');
  }
  if (host === 'willhaben.at') {
    url.protocol = 'https:';
    url.hostname = 'www.willhaben.at';
  }

  // New adverts only ever show up on page 1 of a newest-first list.
  url.searchParams.delete('page');
  if (!url.searchParams.has('sort')) url.searchParams.set('sort', '1'); // 1 = Neueste zuerst
  return url.toString();
}

// ── fetching ────────────────────────────────────────────────────────────────

export async function fetchSearchHtml(url, { timeoutMs = config.requestTimeoutMs } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'de-AT,de;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'upgrade-insecure-requests': '1'
      }
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new WillhabenError(`Timed out after ${timeoutMs}ms`, 'network');
    throw new WillhabenError(err.message, 'network');
  }
  clearTimeout(timer);

  if (res.status === 403 || res.status === 429) {
    throw new WillhabenError(
      `willhaben answered ${res.status} — we are being rate limited. Back off and poll less often.`,
      'blocked',
      res.status
    );
  }
  if (!res.ok) throw new WillhabenError(`willhaben answered HTTP ${res.status}`, 'http', res.status);

  const html = await res.text();
  if (/captcha|are you a human|zugriff verweigert/i.test(html.slice(0, 4000))) {
    throw new WillhabenError('willhaben served a captcha / block page.', 'blocked', res.status);
  }
  return html;
}

// ── parsing ─────────────────────────────────────────────────────────────────

/** Pull the __NEXT_DATA__ JSON out of a page of HTML. */
export function extractNextData(html) {
  const open = html.indexOf('__NEXT_DATA__');
  if (open === -1) return null;
  const start = html.indexOf('>', open);
  const end = html.indexOf('</script>', start);
  if (start === -1 || end === -1) return null;
  const raw = html.slice(start + 1, end).trim();
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const looksLikeAdvert = (o) =>
  o &&
  typeof o === 'object' &&
  !Array.isArray(o) &&
  (o.id != null || o.adId != null) &&
  (o.attributes != null || o.description != null || o.seoUrl != null || o.heading != null);

/** Find every array in the blob that looks like a list of adverts. */
function findAdvertArrays(node, depth = 0, out = []) {
  if (depth > 12 || node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    const hits = node.filter(looksLikeAdvert).length;
    if (hits >= 1 && hits >= node.length / 2) out.push(node);
    for (const v of node) findAdvertArrays(v, depth + 1, out);
    return out;
  }
  for (const v of Object.values(node)) findAdvertArrays(v, depth + 1, out);
  return out;
}

/**
 * Flatten willhaben's `attributes.attribute: [{name, values: [...]}]` shape
 * into a plain lookup. Handles the `attributeMap` variant too.
 */
function attributeMap(advert) {
  const map = Object.create(null);
  const list = advert?.attributes?.attribute ?? advert?.attributes ?? [];
  if (Array.isArray(list)) {
    for (const a of list) {
      if (!a || typeof a !== 'object') continue;
      const name = a.name ?? a.key;
      if (!name) continue;
      const values = Array.isArray(a.values) ? a.values : a.value != null ? [a.value] : [];
      map[String(name).toUpperCase()] = values.map((v) => String(v));
    }
  } else if (list && typeof list === 'object') {
    for (const [k, v] of Object.entries(list)) {
      map[k.toUpperCase()] = Array.isArray(v) ? v.map(String) : [String(v)];
    }
  }
  if (advert?.attributeMap && typeof advert.attributeMap === 'object') {
    for (const [k, v] of Object.entries(advert.attributeMap)) {
      const key = k.toUpperCase();
      if (!(key in map)) map[key] = Array.isArray(v) ? v.map(String) : [String(v)];
    }
  }
  return map;
}

const pick = (map, ...names) => {
  for (const n of names) {
    const v = map[n];
    if (v && v.length && v[0] !== '') return v[0];
  }
  return null;
};

const pickAll = (map, ...names) => {
  for (const n of names) {
    const v = map[n];
    if (v && v.length) return v;
  }
  return [];
};

/**
 * Willhaben hands prices over in several dialects: a bare number in `PRICE`,
 * and de-AT display strings like "€ 1.250,-" or "1.250,00" in the *_FOR_DISPLAY
 * attributes. All of them have to land on 1250.
 */
function parsePrice(...candidates) {
  for (const raw of candidates) {
    if (raw == null) continue;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;

    // Drop currency symbols, spaces and the ",-" dash entirely, then the
    // trailing separator that dash left behind.
    const cleaned = String(raw).replace(/[^\d.,]/g, '').replace(/[.,]+$/, '');
    if (!cleaned) continue;

    // A separator followed by one or two digits at the end is a decimal point;
    // anything else (1.250 / 1,250) is a thousands separator.
    let n;
    if (/,\d{1,2}$/.test(cleaned)) n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
    else if (/\.\d{1,2}$/.test(cleaned) && !cleaned.includes(',')) n = Number(cleaned);
    else n = Number(cleaned.replace(/[.,]/g, ''));

    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function absoluteAdUrl(seoUrl, id) {
  if (seoUrl) {
    const s = String(seoUrl);
    if (/^https?:\/\//i.test(s)) return s;
    return 'https://www.willhaben.at/' + s.replace(/^\/+/, '');
  }
  return id ? `https://www.willhaben.at/iad/object?adId=${encodeURIComponent(id)}` : null;
}

function absoluteImageUrl(raw) {
  if (!raw) return null;
  const first = String(raw).split(/[,;]/)[0].trim();
  if (!first) return null;
  if (/^https?:\/\//i.test(first)) return first;
  return IMAGE_HOST + '/' + first.replace(/^\/+/, '').replace(/^mmo\//, '');
}

function parseTimestamp(...candidates) {
  for (const raw of candidates) {
    if (raw == null || raw === '') continue;
    if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
    const s = String(raw);
    if (/^\d{10}$/.test(s)) return Number(s) * 1000;
    if (/^\d{13}$/.test(s)) return Number(s);
    const t = Date.parse(s);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/** Turn one raw advert object into the shape the rest of the app speaks. */
export function normaliseAdvert(advert) {
  const map = attributeMap(advert);
  const id = String(advert.id ?? advert.adId ?? pick(map, 'ADID', 'AD_ID') ?? '');
  if (!id) return null;

  const title =
    pick(map, 'HEADING', 'TITLE') ||
    advert.description ||
    advert.heading ||
    advert.title ||
    '(no title)';

  const price = parsePrice(
    pick(map, 'PRICE'),
    advert.price,
    pick(map, 'PRICE_FOR_DISPLAY', 'PRICE_FOR_DISPLAY_AMOUNT', 'ESTATE_PRICE')
  );
  const priceText =
    pick(map, 'PRICE_FOR_DISPLAY', 'PRICE_FOR_DISPLAY_AMOUNT') ||
    (price != null ? `€ ${price.toLocaleString('de-AT')}` : null);

  const isPrivate = (() => {
    const v = pick(map, 'ISPRIVATE', 'IS_PRIVATE');
    if (v == null) return null;
    return v === '1' || v.toLowerCase() === 'true';
  })();

  return {
    id,
    title: String(title).trim(),
    price,
    priceText,
    url: absoluteAdUrl(pick(map, 'SEO_URL', 'SEOURL') || advert.seoUrl, id),
    image: absoluteImageUrl(
      pickAll(map, 'ADVERT_IMAGE_LIST', 'IMAGE', 'THUMBNAIL', 'MMO_IMAGE_LIST')[0] ||
        advert.mainImageUrl ||
        advert.imageUrl
    ),
    location: pick(map, 'LOCATION', 'DISTRICT', 'STATE') || null,
    postcode: pick(map, 'POSTCODE', 'POSTCODE_STRING') || null,
    teaser: (pick(map, 'BODY_DYN', 'BODY') || '').slice(0, 400) || null,
    sellerType: isPrivate == null ? 'unknown' : isPrivate ? 'private' : 'dealer',
    publishedAt: parseTimestamp(
      pick(map, 'PUBLISHED'),
      pick(map, 'PUBLISHED_STRING', 'PUBLISHED_String'),
      advert.published
    )
  };
}

/**
 * Parse a search page into normalised adverts.
 * Returns { items, strategy, rowsFound } — `strategy` says how we got there,
 * which is what `npm run probe` prints when something breaks.
 */
export function parseSearchHtml(html) {
  const data = extractNextData(html);
  if (!data) {
    throw new WillhabenError(
      'No __NEXT_DATA__ block in the response — willhaben may have changed their page or served a bot wall.',
      'parse'
    );
  }

  // Fast lane: the documented path, when it is still there.
  const direct = data?.props?.pageProps?.searchResult?.advertSummaryList?.advertSummary;
  let raw = Array.isArray(direct) && direct.length ? direct : null;
  let strategy = raw ? 'advertSummaryList.advertSummary' : null;

  if (!raw) {
    // Fallback: whichever advert-shaped array in the blob is the biggest.
    const candidates = findAdvertArrays(data).sort((a, b) => b.length - a.length);
    if (candidates.length) {
      raw = candidates[0];
      strategy = `deep-scan (${raw.length} entries)`;
    }
  }

  if (!raw) {
    throw new WillhabenError(
      'Found __NEXT_DATA__ but no advert list inside it. If the search works in a browser, run `npm run probe <url>` and check the dump.',
      'parse'
    );
  }

  const seen = new Set();
  const items = [];
  for (const advert of raw) {
    const item = normaliseAdvert(advert);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  if (!items.length) throw new WillhabenError('Advert list was present but empty after normalising.', 'parse');

  const rowsFound = data?.props?.pageProps?.searchResult?.rowsFound ?? null;
  return { items, strategy, rowsFound };
}

export async function runSearch(url, opts) {
  const html = await fetchSearchHtml(url, opts);
  return parseSearchHtml(html);
}
