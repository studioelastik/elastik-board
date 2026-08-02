const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
};

let state = { searches: [], hits: [], settings: {}, subscriptions: 0, vapidPublicKey: '', config: {} };
let token = localStorage.getItem('wh_token') || '';
let editingId = null;
const freshIds = new Set();

// ── api ─────────────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401) {
    localStorage.removeItem('wh_token');
    location.reload();
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(message, bad = false) {
  const node = el('div', { className: `toast${bad ? ' bad' : ''}`, textContent: message });
  $('#toasts').append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .3s, transform .3s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(10px)';
    setTimeout(() => node.remove(), 320);
  }, 3600);
}

// ── formatting ──────────────────────────────────────────────────────────────

const ago = (ts) => {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

const inFuture = (ts) => {
  if (!ts) return '—';
  const s = Math.round((ts - Date.now()) / 1000);
  return s <= 0 ? 'now' : s < 60 ? `in ${s}s` : `in ${Math.round(s / 60)}m`;
};

const money = (item) =>
  item.priceText || (item.price != null ? `€ ${item.price.toLocaleString('de-AT')}` : 'Preis auf Anfrage');

// ── rendering ───────────────────────────────────────────────────────────────

function statusPill(s) {
  if (!s.enabled) return el('span', { className: 'pill idle', textContent: 'paused' });
  if (s.lastError) return el('span', { className: 'pill bad', textContent: s.lastError.kind });
  if (!s.seeded) return el('span', { className: 'pill warn', textContent: 'arming…' });
  return el('span', { className: 'pill ok', textContent: 'watching' });
}

function renderSearches() {
  const host = $('#searches');
  host.replaceChildren();
  $('#search-count').textContent = state.searches.length;

  if (!state.searches.length) {
    host.append(
      el('div', { className: 'empty' },
        el('strong', { textContent: 'No searches yet' }),
        'Paste a willhaben search URL and this will poll it every minute.'
      )
    );
    return;
  }

  for (const s of state.searches) {
    const toggle = el('input', { type: 'checkbox', checked: s.enabled });
    toggle.onchange = () => patchSearch(s.id, { enabled: toggle.checked });

    const meta = el('div', { className: 'search-meta' },
      el('span', { textContent: `every ${s.intervalSec}s` }),
      el('span', { textContent: `last check ${ago(s.lastRunAt)}` }),
      el('span', { textContent: s.enabled ? `next ${inFuture(s.nextRunAt)}` : 'paused' }),
      el('span', { textContent: `${s.lastCount} on page 1` }),
      el('span', { textContent: `${s.stats.found} found` }),
      s.filtersLabel ? el('span', { textContent: s.filtersLabel }) : null
    );

    const card = el('div', { className: 'card search-card' },
      el('div', { className: 'search-head' },
        el('label', { className: 'switch' }, toggle, el('span')),
        el('div', { style: 'min-width:0;flex:1' },
          el('div', { className: 'search-name', textContent: s.name }),
          el('div', { className: 'search-url', textContent: decodeURI(s.url) })
        ),
        statusPill(s)
      ),
      meta,
      s.lastError
        ? el('div', { className: 'banner bad', style: 'font-size:12px' }, `${s.lastError.message} (${ago(s.lastError.at)})`)
        : null,
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
        el('button', { className: 'btn ghost', textContent: s.running ? 'checking…' : 'Check now', disabled: s.running,
          onclick: () => runNow(s.id) }),
        el('button', { className: 'btn ghost', textContent: 'Edit', onclick: () => openSearchDialog(s) }),
        el('a', { className: 'btn ghost', href: s.url, target: '_blank', rel: 'noopener', textContent: 'Open on willhaben' }),
        el('div', { className: 'spacer', style: 'flex:1' }),
        el('button', { className: 'btn ghost danger', textContent: 'Delete', onclick: () => removeSearch(s) })
      )
    );
    host.append(card);
  }
}

function renderHits() {
  const host = $('#hits');
  host.replaceChildren();
  $('#hit-count').textContent = state.hits.length;

  if (!state.hits.length) {
    host.append(
      el('div', { className: 'empty' },
        el('strong', { textContent: 'Nothing new yet' }),
        'Adverts that appear after a search is armed will show up here — and on your phone.'
      )
    );
    return;
  }

  for (const hit of state.hits.slice(0, 120)) {
    const img = hit.image
      ? el('img', { src: hit.image, loading: 'lazy', alt: '', onerror: (e) => e.target.remove() })
      : null;
    host.append(
      el('a', {
        className: `hit${freshIds.has(hit.id) ? ' fresh' : ''}`,
        href: hit.url || '#', target: '_blank', rel: 'noopener'
      },
        img,
        el('div', { className: 'body' },
          el('div', { className: 'title', textContent: hit.title }),
          el('div', { className: 'price', textContent: money(hit) }),
          el('div', { className: 'sub' },
            el('span', { textContent: [hit.postcode, hit.location].filter(Boolean).join(' ') || '—' }),
            el('span', { textContent: hit.sellerType !== 'unknown' ? hit.sellerType : '' }),
            el('span', { textContent: hit.searchName }),
            el('span', { textContent: ago(hit.foundAt) })
          )
        )
      )
    );
  }
}

const render = () => { renderSearches(); renderHits(); };

// ── actions ─────────────────────────────────────────────────────────────────

async function refresh() {
  state = await api('/api/state');
  render();
  syncSettingsForm();
  updatePushUi();
}

async function patchSearch(id, patch) {
  try {
    await api(`/api/searches/${id}`, { method: 'PATCH', body: patch });
    await refresh();
  } catch (err) { toast(err.message, true); }
}

async function runNow(id) {
  try {
    const { result } = await api(`/api/searches/${id}/run`, { method: 'POST' });
    if (result.error) toast(result.error.message, true);
    else if (result.seeded) toast(`Armed — remembering ${result.count} current adverts`);
    else toast(result.new ? `${result.new} new` : `Nothing new (${result.count} on page 1)`);
    await refresh();
  } catch (err) { toast(err.message, true); }
}

async function removeSearch(s) {
  if (!confirm(`Delete "${s.name}"?`)) return;
  await api(`/api/searches/${s.id}`, { method: 'DELETE' });
  await refresh();
}

// ── search dialog ───────────────────────────────────────────────────────────

const dialog = $('#search-dialog');

function openSearchDialog(search = null) {
  editingId = search?.id || null;
  $('#dialog-title').textContent = search ? 'Edit search' : 'New search';
  $('#f-url').value = search?.url || '';
  $('#f-name').value = search?.name || '';
  $('#f-interval').value = search?.intervalSec || state.config.defaultIntervalSec || 60;
  $('#f-interval').min = state.config.minIntervalSec || 20;
  $('#f-min').value = search?.filters?.minPrice ?? '';
  $('#f-max').value = search?.filters?.maxPrice ?? '';
  $('#f-seller').value = search?.filters?.sellerType || 'any';
  $('#f-include').value = (search?.filters?.include || []).join(', ');
  $('#f-exclude').value = (search?.filters?.exclude || []).join(', ');
  $('#preview-slot').replaceChildren();
  dialog.showModal();
}

const formValues = () => ({
  url: $('#f-url').value.trim(),
  name: $('#f-name').value.trim() || 'Unnamed search',
  intervalSec: Number($('#f-interval').value) || 60,
  filters: {
    minPrice: $('#f-min').value === '' ? null : Number($('#f-min').value),
    maxPrice: $('#f-max').value === '' ? null : Number($('#f-max').value),
    sellerType: $('#f-seller').value,
    include: $('#f-include').value,
    exclude: $('#f-exclude').value
  }
});

$('#preview-btn').onclick = async () => {
  const slot = $('#preview-slot');
  slot.replaceChildren(el('div', { className: 'preview' }, 'Fetching…'));
  try {
    const data = await api('/api/preview', { method: 'POST', body: { url: $('#f-url').value.trim() } });
    slot.replaceChildren(
      el('div', { className: 'preview' },
        el('div', { className: 'row' }, el('b', { textContent: `${data.count} adverts` }),
          `on page 1 of ${data.rowsFound ?? '?'} total`),
        el('div', { className: 'row' }, 'parsed via ', el('b', { textContent: data.strategy })),
        ...data.items.map((i) =>
          el('div', { className: 'row' }, el('b', { textContent: money(i) }), i.title.slice(0, 70))
        )
      )
    );
  } catch (err) {
    slot.replaceChildren(el('div', { className: 'banner bad' }, err.message));
  }
};

$('#cancel-btn').onclick = () => dialog.close();
$('#add-btn').onclick = () => openSearchDialog();

$('#search-form').onsubmit = async (e) => {
  e.preventDefault();
  const body = formValues();
  if (!body.url) return;
  try {
    if (editingId) await api(`/api/searches/${editingId}`, { method: 'PATCH', body });
    else await api('/api/searches', { method: 'POST', body });
    dialog.close();
    toast(editingId ? 'Saved' : 'Search added — arming now');
    await refresh();
  } catch (err) { toast(err.message, true); }
};

// ── settings ────────────────────────────────────────────────────────────────

const settingsDialog = $('#settings-dialog');

function syncSettingsForm() {
  const s = state.settings || {};
  $('#s-tg-enabled').checked = !!s.telegram?.enabled;
  $('#s-tg-token').value = s.telegram?.botToken || '';
  $('#s-tg-chat').value = s.telegram?.chatId || '';
  $('#s-wh-enabled').checked = !!s.webhook?.enabled;
  $('#s-wh-url').value = s.webhook?.url || '';
  $('#s-wh-format').value = s.webhook?.format || 'json';
  $('#s-err').checked = s.notifyOnError !== false;
}

$('#settings-btn').onclick = () => { syncSettingsForm(); updatePushUi(); settingsDialog.showModal(); };
$('#settings-cancel').onclick = () => settingsDialog.close();

$('#settings-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/settings', {
      method: 'POST',
      body: {
        telegram: {
          enabled: $('#s-tg-enabled').checked,
          botToken: $('#s-tg-token').value.trim(),
          chatId: $('#s-tg-chat').value.trim()
        },
        webhook: {
          enabled: $('#s-wh-enabled').checked,
          url: $('#s-wh-url').value.trim(),
          format: $('#s-wh-format').value
        },
        notifyOnError: $('#s-err').checked
      }
    });
    settingsDialog.close();
    toast('Settings saved');
    await refresh();
  } catch (err) { toast(err.message, true); }
};

$('#test-notification').onclick = async () => {
  try {
    const r = await api('/api/test-notification', { method: 'POST' });
    toast(`Sent to ${r.subscriptions} device(s) + any other channels`);
  } catch (err) { toast(err.message, true); }
};

$('#clear-hits').onclick = async () => {
  await api('/api/hits', { method: 'DELETE' });
  await refresh();
};

// ── web push ────────────────────────────────────────────────────────────────

const urlBase64ToUint8Array = (base64) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window;

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function enablePush() {
  if (!pushSupported()) {
    toast('This browser has no push support. On iPhone: add to Home Screen first.', true);
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { toast('Notification permission denied', true); return; }
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.vapidPublicKey)
      }));
    await api('/api/subscribe', { method: 'POST', body: sub.toJSON() });
    toast('Notifications on for this device');
    await refresh();
  } catch (err) {
    toast(`Could not enable push: ${err.message}`, true);
  }
}

async function disablePush() {
  const sub = await currentSubscription();
  if (sub) {
    await api('/api/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
  toast('Notifications off for this device');
  await refresh();
}

async function updatePushUi() {
  const banner = $('#push-banner');
  const stateLine = $('#push-state');
  const toggle = $('#push-toggle');

  if (!pushSupported()) {
    banner.hidden = false;
    banner.classList.add('bad');
    $('#push-banner-text').textContent =
      'This browser cannot do web push. On iOS you must add the app to the Home Screen first; otherwise use Telegram in settings.';
    $('#push-enable').hidden = true;
    stateLine.textContent = 'Not supported in this browser.';
    toggle.disabled = true;
    return;
  }

  if (!window.isSecureContext) {
    banner.hidden = false;
    banner.classList.add('bad');
    $('#push-banner-text').textContent =
      'Push needs HTTPS (or localhost). Reach this server over https and the option appears.';
    $('#push-enable').hidden = true;
    stateLine.textContent = 'Insecure context — push unavailable.';
    toggle.disabled = true;
    return;
  }

  const sub = await currentSubscription();
  const on = !!sub && Notification.permission === 'granted';
  banner.hidden = on;
  banner.classList.remove('bad');
  $('#push-enable').hidden = false;
  stateLine.textContent = on
    ? `On for this device. ${state.subscriptions} device(s) subscribed in total.`
    : `Off on this device. Permission: ${Notification.permission}.`;
  toggle.textContent = on ? 'Disable on this device' : 'Enable on this device';
  toggle.disabled = false;
  toggle.onclick = on ? disablePush : enablePush;
}

$('#push-enable').onclick = enablePush;

// ── live updates ────────────────────────────────────────────────────────────

function connectEvents() {
  const url = token ? `/api/events?token=${encodeURIComponent(token)}` : '/api/events';
  const es = new EventSource(url);

  es.onopen = () => {
    $('#live-dot').classList.add('live');
    $('#live-label').textContent = 'live';
  };
  es.onerror = () => {
    $('#live-dot').classList.remove('live');
    $('#live-label').textContent = 'reconnecting…';
  };
  es.onmessage = async (e) => {
    const event = JSON.parse(e.data);
    if (event.type === 'hits') {
      for (const item of event.items) freshIds.add(item.id);
      setTimeout(() => { for (const item of event.items) freshIds.delete(item.id); }, 12_000);
      toast(`${event.items.length} new on willhaben`);
    }
    await refresh();
  };
}

// ── theme ───────────────────────────────────────────────────────────────────

const applyTheme = (theme) => {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('wh_theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#080808' : '#F5F5F5');
};

$('#theme-btn').onclick = () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

applyTheme(
  localStorage.getItem('wh_theme') ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
);

// ── boot ────────────────────────────────────────────────────────────────────

$('#login-btn').onclick = () => {
  token = $('#login-token').value.trim();
  localStorage.setItem('wh_token', token);
  location.reload();
};
$('#login-token').onkeydown = (e) => { if (e.key === 'Enter') $('#login-btn').click(); };

async function boot() {
  const { required } = await fetch('/api/auth-required').then((r) => r.json());
  if (required && !token) {
    $('#login').hidden = false;
    $('#login-token').focus();
    return;
  }
  try {
    await refresh();
  } catch {
    $('#login').hidden = false;
    return;
  }
  $('#app').hidden = false;
  connectEvents();

  if (pushSupported()) navigator.serviceWorker.register('sw.js').catch(() => {});
  // Keep the relative timestamps honest without hammering the API.
  setInterval(render, 10_000);
  setInterval(() => refresh().catch(() => {}), 60_000);
}

boot();
