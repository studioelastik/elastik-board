/**
 * Client-side filtering on top of whatever the willhaben query already
 * narrowed down. Deliberately forgiving: when a field is unknown (price on a
 * "price on request" advert, seller type on some verticals) we let the advert
 * through rather than silently swallowing the one you were waiting for.
 */

export function matches(item, filters) {
  if (!filters) return true;
  const { minPrice, maxPrice, include, exclude, sellerType } = filters;

  if (item.price != null) {
    if (minPrice != null && Number.isFinite(minPrice) && item.price < minPrice) return false;
    if (maxPrice != null && Number.isFinite(maxPrice) && item.price > maxPrice) return false;
  }

  const haystack = `${item.title || ''} ${item.teaser || ''}`.toLowerCase();

  // include = ANY of these words (an OR list of synonyms is the useful default)
  if (include?.length && !include.some((w) => haystack.includes(w))) return false;
  // exclude = NONE of these words
  if (exclude?.length && exclude.some((w) => haystack.includes(w))) return false;

  if (sellerType && sellerType !== 'any' && item.sellerType !== 'unknown') {
    if (item.sellerType !== sellerType) return false;
  }

  return true;
}

export const describeFilters = (f) => {
  if (!f) return '';
  const parts = [];
  if (f.minPrice != null) parts.push(`≥ €${f.minPrice}`);
  if (f.maxPrice != null) parts.push(`≤ €${f.maxPrice}`);
  if (f.include?.length) parts.push(`incl: ${f.include.join(', ')}`);
  if (f.exclude?.length) parts.push(`excl: ${f.exclude.join(', ')}`);
  if (f.sellerType && f.sellerType !== 'any') parts.push(f.sellerType);
  return parts.join(' · ');
};
