import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSearchHtml,
  normaliseSearchUrl,
  normaliseAdvert,
  extractNextData,
  WillhabenError
} from '../src/willhaben.js';
import { advert, pageHtml, restructuredHtml, html } from './fixtures.js';

test('parses the documented advertSummary path', () => {
  const { items, strategy, rowsFound } = parseSearchHtml(pageHtml([advert(1), advert(2), advert(3)]));
  assert.equal(items.length, 3);
  assert.equal(strategy, 'advertSummaryList.advertSummary');
  assert.equal(rowsFound, 4321);
  assert.deepEqual(items.map((i) => i.id), ['1', '2', '3']);
});

test('normalises every field of an advert', () => {
  const [item] = parseSearchHtml(pageHtml([advert(42, { price: 1899, title: 'Rennrad Ultegra' })])).items;
  assert.equal(item.id, '42');
  assert.equal(item.title, 'Rennrad Ultegra');
  assert.equal(item.price, 1899);
  assert.equal(item.url, 'https://www.willhaben.at/iad/kaufen-und-verkaufen/d/rennrad-42/');
  assert.equal(item.location, 'Wien, 07. Bezirk, Neubau');
  assert.equal(item.postcode, '1070');
  assert.equal(item.sellerType, 'private');
  assert.ok(item.image.startsWith('https://cache.willhaben.at/mmo/'));
  assert.equal(typeof item.publishedAt, 'number');
});

test('falls back to a deep scan when the known path moves', () => {
  const { items, strategy } = parseSearchHtml(restructuredHtml([advert(7), advert(8)]));
  assert.equal(items.length, 2);
  assert.match(strategy, /deep-scan/);
});

test('de-duplicates adverts that appear twice on a page', () => {
  const { items } = parseSearchHtml(pageHtml([advert(1), advert(1), advert(2)]));
  assert.deepEqual(items.map((i) => i.id), ['1', '2']);
});

test('parses German and plain number formats into the same value', () => {
  const cases = [
    ['1.250,00', 1250],   // de-AT with decimals
    ['€ 1.250,-', 1250],  // the form willhaben actually displays
    ['1.250', 1250],      // de-AT thousands separator, no decimals
    ['1,250', 1250],      // en thousands separator
    ['1250.00', 1250],    // plain
    ['1250', 1250],
    ['999,99', 999.99],
    ['999.99', 999.99]
  ];
  for (const [raw, expected] of cases) {
    const [item] = parseSearchHtml(pageHtml([advert(1, { price: raw })])).items;
    assert.equal(item.price, expected, `${raw} → ${expected}`);
  }
});

test('survives an advert missing almost every attribute', () => {
  const item = normaliseAdvert({ id: 99, description: 'Bare advert' });
  assert.equal(item.id, '99');
  assert.equal(item.title, 'Bare advert');
  assert.equal(item.price, null);
  assert.equal(item.sellerType, 'unknown');
  // No SEO_URL still has to produce something clickable.
  assert.equal(item.url, 'https://www.willhaben.at/iad/object?adId=99');
});

test('rejects an advert with no id at all', () => {
  assert.equal(normaliseAdvert({ description: 'no id' }), null);
});

test('reports a bot wall as a parse error rather than crashing', () => {
  assert.throws(() => parseSearchHtml('<html><body>Access denied</body></html>'), WillhabenError);
});

test('reports an empty result page distinctly', () => {
  assert.throws(() => parseSearchHtml(pageHtml([])), /no advert list|empty/i);
});

test('extractNextData tolerates surrounding markup', () => {
  const data = extractNextData(html({ props: { hello: 'world' } }));
  assert.equal(data.props.hello, 'world');
});

test('URL normalisation forces newest-first page 1', () => {
  const out = normaliseSearchUrl('https://willhaben.at/iad/kaufen-und-verkaufen/marktplatz?keyword=rennrad&page=4');
  const url = new URL(out);
  assert.equal(url.hostname, 'www.willhaben.at');
  assert.equal(url.protocol, 'https:');
  assert.equal(url.searchParams.get('sort'), '1');
  assert.equal(url.searchParams.has('page'), false);
  assert.equal(url.searchParams.get('keyword'), 'rennrad');
});

test('URL normalisation keeps a sort the user chose', () => {
  const url = new URL(normaliseSearchUrl('https://www.willhaben.at/iad/immobilien?sort=3'));
  assert.equal(url.searchParams.get('sort'), '3');
});

test('URL normalisation refuses anything that is not willhaben', () => {
  assert.throws(() => normaliseSearchUrl('https://example.com/iad/search'), /willhaben/);
  assert.throws(() => normaliseSearchUrl('not a url'), /URL/);
});
