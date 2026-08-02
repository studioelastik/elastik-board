import test from 'node:test';
import assert from 'node:assert/strict';
import { matches } from '../src/filters.js';
import { normaliseFilters } from '../src/store.js';

const item = (over = {}) => ({
  id: '1',
  title: 'Rennrad Carbon Ultegra 56cm',
  teaser: 'Wenig gefahren, kleiner Kratzer',
  price: 1200,
  sellerType: 'private',
  ...over
});

test('price range', () => {
  assert.equal(matches(item(), normaliseFilters({ minPrice: 1000, maxPrice: 1500 })), true);
  assert.equal(matches(item(), normaliseFilters({ maxPrice: 900 })), false);
  assert.equal(matches(item(), normaliseFilters({ minPrice: 2000 })), false);
});

test('an unknown price is never filtered out by a price range', () => {
  assert.equal(matches(item({ price: null }), normaliseFilters({ minPrice: 500, maxPrice: 900 })), true);
});

test('include is an OR list across title and teaser', () => {
  assert.equal(matches(item(), normaliseFilters({ include: 'ultegra, dura-ace' })), true);
  assert.equal(matches(item(), normaliseFilters({ include: 'kratzer' })), true, 'matches the teaser too');
  assert.equal(matches(item(), normaliseFilters({ include: 'mountainbike' })), false);
});

test('exclude wins over include', () => {
  assert.equal(matches(item(), normaliseFilters({ include: 'ultegra', exclude: 'kratzer' })), false);
});

test('matching is case-insensitive', () => {
  assert.equal(matches(item(), normaliseFilters({ include: 'CARBON' })), true);
  assert.equal(matches(item({ title: 'RENNRAD DEFEKT' }), normaliseFilters({ exclude: 'defekt' })), false);
});

test('seller type, with unknown treated as a pass', () => {
  assert.equal(matches(item(), normaliseFilters({ sellerType: 'private' })), true);
  assert.equal(matches(item(), normaliseFilters({ sellerType: 'dealer' })), false);
  assert.equal(matches(item({ sellerType: 'unknown' }), normaliseFilters({ sellerType: 'dealer' })), true);
});

test('empty filters pass everything', () => {
  assert.equal(matches(item(), normaliseFilters({})), true);
  assert.equal(matches(item(), null), true);
});

test('normaliseFilters cleans up messy input', () => {
  const f = normaliseFilters({ include: ' Carbon , ,ULTEGRA ', maxPrice: '', sellerType: 'nonsense' });
  assert.deepEqual(f.include, ['carbon', 'ultegra']);
  assert.equal(f.maxPrice, null);
  assert.equal(f.sellerType, 'any');
});
