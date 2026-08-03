/**
 * Synthetic willhaben pages. These mirror the __NEXT_DATA__ shape the parser
 * targets — they are not captured from the live site, so they prove the
 * parser's logic, not that willhaben still serves exactly this today. That is
 * what `npm run probe` is for.
 */

export const advert = (id, overrides = {}) => ({
  id,
  verticalId: 5,
  description: `Advert ${id}`,
  attributes: {
    attribute: [
      { name: 'HEADING', values: [overrides.title ?? `Rennrad Carbon ${id}`] },
      { name: 'BODY_DYN', values: [overrides.body ?? 'Guter Zustand, wenig gefahren.'] },
      { name: 'PRICE', values: [String(overrides.price ?? 1250)] },
      { name: 'PRICE_FOR_DISPLAY', values: [overrides.priceText ?? `€ ${overrides.price ?? 1250},-`] },
      { name: 'POSTCODE', values: ['1070'] },
      { name: 'LOCATION', values: ['Wien, 07. Bezirk, Neubau'] },
      { name: 'ISPRIVATE', values: [overrides.isPrivate === false ? '0' : '1'] },
      { name: 'SEO_URL', values: [`iad/kaufen-und-verkaufen/d/rennrad-${id}/`] },
      { name: 'ADVERT_IMAGE_LIST', values: ['/6/394/818/mmo/9/' + id + '_-1.jpg'] },
      { name: 'PUBLISHED', values: ['1722500000000'] }
    ]
  }
});

export const nextDataPage = (adverts, { rowsFound = 4321 } = {}) => ({
  props: {
    pageProps: {
      searchResult: {
        rowsFound,
        advertSummaryList: { advertSummary: adverts }
      }
    }
  },
  page: '/iad/kaufen-und-verkaufen/marktplatz',
  buildId: 'test-build'
});

export const html = (nextData) => `<!DOCTYPE html>
<html><head><title>willhaben</title></head>
<body><div id="__next">…markup…</div>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
</body></html>`;

export const pageHtml = (adverts, opts) => html(nextDataPage(adverts, opts));

/** Same adverts, but hidden behind a shape the fast lane does not know. */
export const restructuredHtml = (adverts) =>
  html({
    props: { pageProps: { dehydratedState: { queries: [{ state: { data: { results: { list: adverts } } } }] } } }
  });
