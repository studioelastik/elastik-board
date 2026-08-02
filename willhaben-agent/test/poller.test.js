/**
 * End-to-end test of the bit that actually matters: does a poll notice exactly
 * the adverts that are new, exactly once? Runs against a local stand-in for
 * willhaben so the diffing logic is exercised for real.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { advert, pageHtml } from './fixtures.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-agent-test-'));
process.env.DATA_DIR = dataDir;
process.env.WILLHABEN_ALLOW_ANY_HOST = '1';
process.env.MIN_REQUEST_SPACING_MS = '0';
process.env.MIN_POLL_INTERVAL_SEC = '1';

const store = await import('../src/store.js');
const { initPush } = await import('../src/notify.js');
const { pollSearch } = await import('../src/poller.js');
const { normaliseSearchUrl } = await import('../src/willhaben.js');

store.load();
initPush();

// ── stand-in for willhaben ──────────────────────────────────────────────────

let adverts = [advert(1), advert(2), advert(3)];
let mode = 'ok';

const fake = http.createServer((req, res) => {
  if (mode === 'error') {
    res.writeHead(500);
    return res.end('boom');
  }
  if (mode === 'blocked') {
    res.writeHead(429);
    return res.end('slow down');
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(pageHtml(adverts));
});

await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${fake.address().port}/iad/kaufen-und-verkaufen`;

test.after(() => {
  fake.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ── tests ───────────────────────────────────────────────────────────────────

test('first poll arms silently instead of notifying about the whole page', async () => {
  const search = store.addSearch({ name: 'e2e', url: normaliseSearchUrl(base) });
  const result = await pollSearch(search);
  assert.equal(result.seeded, true);
  assert.equal(result.count, 3);
  assert.equal(search.seeded, true);
  assert.equal(search.seen.length, 3);
  assert.equal(store.getDb().hits.length, 0, 'nothing lands in the feed on the seeding run');
});

test('a newly listed advert is reported exactly once', async () => {
  const search = store.getDb().searches.find((s) => s.name === 'e2e');

  adverts = [advert(4), ...adverts]; // willhaben puts the newest on top
  const first = await pollSearch(search);
  assert.equal(first.new, 1);
  assert.equal(store.getDb().hits.length, 1);
  assert.equal(store.getDb().hits[0].id, '4');

  const second = await pollSearch(search);
  assert.equal(second.new, 0, 'the same advert must not fire twice');
  assert.equal(store.getDb().hits.length, 1);
});

test('an advert dropping off page 1 and coming back does not re-fire', async () => {
  const search = store.getDb().searches.find((s) => s.name === 'e2e');
  const withoutFour = adverts.filter((a) => a.id !== 4);
  adverts = withoutFour;
  await pollSearch(search);
  adverts = [advert(4), ...withoutFour];
  const result = await pollSearch(search);
  assert.equal(result.new, 0);
});

test('filters suppress the notification but the advert still counts as seen', async () => {
  const search = store.addSearch({
    name: 'cheap only',
    url: normaliseSearchUrl(base + '?x=1'),
    filters: { maxPrice: 500 }
  });
  adverts = [advert(1), advert(2)];
  await pollSearch(search); // arm

  adverts = [advert(50, { price: 4000 }), ...adverts];
  const pricey = await pollSearch(search);
  assert.equal(pricey.new, 0, 'over budget — no notification');
  assert.equal(pricey.filteredOut, 1);
  assert.ok(search._seenSet.has('50'), 'still remembered, so it cannot fire later');

  adverts = [advert(51, { price: 300 }), ...adverts];
  const bargain = await pollSearch(search);
  assert.equal(bargain.new, 1);
  assert.equal(store.getDb().hits[0].id, '51');
});

test('an HTTP failure is recorded without losing the seen set', async () => {
  const search = store.getDb().searches.find((s) => s.name === 'e2e');
  const seenBefore = search.seen.length;

  mode = 'error';
  const result = await pollSearch(search);
  assert.ok(result.error);
  assert.equal(search.consecutiveErrors, 1);
  assert.equal(search.lastError.kind, 'http');
  assert.equal(search.seen.length, seenBefore, 'a failed poll must not forget anything');

  mode = 'ok';
  await pollSearch(search);
  assert.equal(search.consecutiveErrors, 0, 'recovery clears the error state');
  assert.equal(search.lastError, null);
});

test('rate limiting is classified as blocked so backoff kicks in', async () => {
  const search = store.getDb().searches.find((s) => s.name === 'e2e');
  mode = 'blocked';
  await pollSearch(search);
  assert.equal(search.lastError.kind, 'blocked');
  mode = 'ok';
});

test('changing the URL re-arms rather than firing on the new result set', async () => {
  const search = store.getDb().searches.find((s) => s.name === 'e2e');
  store.updateSearch(search.id, { url: normaliseSearchUrl(base + '?other=1') });
  assert.equal(search.seeded, false);
  assert.equal(search.seen.length, 0);

  const hitsBefore = store.getDb().hits.length;
  const result = await pollSearch(search);
  assert.equal(result.seeded, true);
  assert.equal(store.getDb().hits.length, hitsBefore, 'the new result set must not flood the feed');
});

test('the seen list is capped and the database round-trips', async () => {
  const search = store.getDb().searches.find((s) => s.name === 'e2e');
  store.markSeen(search, Array.from({ length: 5000 }, (_, i) => `pad-${i}`));
  assert.ok(search.seen.length <= 3000, 'capped');
  assert.equal(search.seen.length, search._seenSet.size, 'set and list stay in step');

  await store.flush();
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.equal(raw.searches.length, 2);
  assert.ok(!('_seenSet' in raw.searches[0]), 'runtime-only fields are not persisted');
});
