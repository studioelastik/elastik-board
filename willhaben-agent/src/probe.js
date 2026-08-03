/**
 * Diagnostic: `npm run probe -- "<willhaben search url>"`
 *
 * Fetches one search page and prints exactly what the parser saw. This is the
 * first thing to run if a search stops finding anything — it tells you whether
 * willhaben blocked us, changed their JSON shape, or the query is just empty.
 * `--dump` writes the raw HTML next to the data dir for eyeballing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { fetchSearchHtml, parseSearchHtml, normaliseSearchUrl, WillhabenError } from './willhaben.js';

const args = process.argv.slice(2);
const dump = args.includes('--dump');
const input = args.find((a) => !a.startsWith('--'));

if (!input) {
  console.error('usage: npm run probe -- "https://www.willhaben.at/iad/…" [--dump]');
  process.exit(1);
}

try {
  const url = normaliseSearchUrl(input);
  console.log(`→ ${url}\n`);

  const started = Date.now();
  const html = await fetchSearchHtml(url);
  console.log(`fetched ${html.length.toLocaleString()} bytes in ${Date.now() - started}ms`);

  if (dump) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const file = path.join(config.dataDir, `probe-${Date.now()}.html`);
    fs.writeFileSync(file, html);
    console.log(`raw HTML → ${file}`);
  }

  const { items, strategy, rowsFound } = parseSearchHtml(html);
  console.log(`strategy: ${strategy}`);
  console.log(`rowsFound (willhaben's own total): ${rowsFound ?? 'n/a'}`);
  console.log(`parsed ${items.length} adverts on page 1\n`);

  for (const item of items.slice(0, 10)) {
    const price = item.priceText || (item.price != null ? `€ ${item.price}` : '—');
    const when = item.publishedAt ? new Date(item.publishedAt).toLocaleString('de-AT') : 'unknown date';
    console.log(`  [${item.id}] ${item.title}`);
    console.log(`      ${price} · ${[item.postcode, item.location].filter(Boolean).join(' ') || '—'} · ${item.sellerType} · ${when}`);
    console.log(`      ${item.url}`);
  }
  if (items.length > 10) console.log(`  … and ${items.length - 10} more`);

  const missing = ['url', 'price', 'location', 'publishedAt'].filter(
    (f) => items.filter((i) => i[f] == null).length > items.length / 2
  );
  if (missing.length) {
    console.log(`\n⚠ mostly empty fields: ${missing.join(', ')} — willhaben may have renamed those attributes.`);
    console.log('  Matching still works (it keys on advert id), only the notification text gets thinner.');
  }
} catch (err) {
  console.error(`\n✖ ${err.message}`);
  if (err instanceof WillhabenError) {
    console.error(`  kind: ${err.kind}${err.status ? ` (HTTP ${err.status})` : ''}`);
    if (err.kind === 'blocked') console.error('  → poll less often, or wait a few minutes before retrying.');
    if (err.kind === 'parse') console.error('  → re-run with --dump and inspect the HTML.');
  }
  process.exit(1);
}
