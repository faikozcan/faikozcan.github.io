'use strict';

// ---------- IndexedDB ----------
const DB_NAME = 'konum-db';
const STORE = 'points';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      store.createIndex('t', 't');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbReady = openDb();

async function tx(mode, fn) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

const addPoint = p => tx('readwrite', s => s.add(p));
const deletePoint = id => tx('readwrite', s => s.delete(id));
const clearPoints = () => tx('readwrite', s => s.clear());
const allPoints = () => tx('readonly', s => s.getAll());

// ---------- Settings (per-device conveniences) ----------
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// ---------- Elements ----------
const $ = id => document.getElementById(id);
const el = {
  interval: $('interval'), toggle: $('toggle'), now: $('now'), dot: $('dot'),
  statusText: $('statusText'), wake: $('wake'), list: $('list'), count: $('count'),
  route: $('route'), gpx: $('gpx'), csv: $('csv'), clear: $('clear'), toast: $('toast'),
};

let tracking = load('tracking', false);
let lastSaved = load('lastSaved', 0);
let timer = null;
let wakeLock = null;
let busy = false;

el.interval.value = String(load('interval', 900));
el.wake.checked = load('wake', false);

// ---------- Helpers ----------
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.toast.classList.remove('show'), 2500);
}

const fmtTime = t => new Date(t).toLocaleString('tr-TR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const fix = n => n.toFixed(6);
const intervalMs = () => Number(el.interval.value) * 1000;

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(navigator.userAgent);

function mapLinks(p) {
  const ll = `${fix(p.lat)},${fix(p.lng)}`;
  const label = encodeURIComponent(fmtTime(p.t));
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${ll}`,
    apple: `https://maps.apple.com/?ll=${ll}&q=${label}`,
    osm: `https://www.openstreetmap.org/?mlat=${fix(p.lat)}&mlon=${fix(p.lng)}#map=17/${fix(p.lat)}/${fix(p.lng)}`,
    // Android shows the "open with" chooser for any installed map app.
    geo: `geo:${ll}?q=${ll}(${label})`,
  };
}

function defaultMap(p) {
  const l = mapLinks(p);
  if (isAndroid) return { href: l.geo, name: 'Haritada aç' };
  if (isIOS) return { href: l.apple, name: 'Haritada aç' };
  return { href: l.google, name: 'Haritada aç' };
}

function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Location ----------
function getPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, timeout: 30000, maximumAge: 0,
    });
  });
}

async function record() {
  if (busy) return;
  busy = true;
  updateStatus();
  try {
    const pos = await getPosition();
    const c = pos.coords;
    await addPoint({
      t: pos.timestamp || Date.now(),
      lat: c.latitude, lng: c.longitude,
      acc: c.accuracy, alt: c.altitude, spd: c.speed,
    });
    lastSaved = Date.now();
    save('lastSaved', lastSaved);
    await render();
  } catch (err) {
    const msg = { 1: 'Konum izni reddedildi', 2: 'Konum alınamadı', 3: 'Konum zaman aşımı' }[err.code] || err.message;
    toast(msg);
    if (err.code === 1 && tracking) stop();
  } finally {
    busy = false;
    updateStatus();
  }
}

// Timers are throttled or frozen while the page is hidden, so this checks
// whether a recording is due instead of trusting the timer to fire on time.
function tick() {
  if (tracking && Date.now() - lastSaved >= intervalMs() - 1000) record();
  updateStatus();
}

async function acquireWakeLock() {
  if (!el.wake.checked || !tracking || !('wakeLock' in navigator) || document.hidden) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* not allowed right now */ }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release();
  wakeLock = null;
}

function start() {
  if (!('geolocation' in navigator)) { toast('Bu cihaz konum desteklemiyor'); return; }
  tracking = true;
  save('tracking', true);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  clearInterval(timer);
  timer = setInterval(tick, 5000);
  lastSaved = 0; // record immediately on start
  tick();
  acquireWakeLock();
  updateStatus();
}

function stop() {
  tracking = false;
  save('tracking', false);
  clearInterval(timer);
  timer = null;
  releaseWakeLock();
  updateStatus();
}

function updateStatus() {
  el.toggle.textContent = tracking ? 'Kaydı durdur' : 'Kaydı başlat';
  el.toggle.className = (tracking ? 'stop' : 'primary') + ' big';
  el.dot.classList.toggle('on', tracking);
  if (!tracking) { el.statusText.textContent = 'Durduruldu'; return; }
  const next = Math.max(0, Math.round((lastSaved + intervalMs() - Date.now()) / 1000));
  const m = Math.floor(next / 60), s = next % 60;
  el.statusText.textContent = busy ? 'Konum alınıyor…'
    : `Kayıt açık · sonraki kayıt ${m ? m + ' dk ' : ''}${s} sn içinde`;
}

// ---------- Rendering ----------
async function render() {
  const pts = (await allPoints()).sort((a, b) => b.t - a.t);
  el.count.textContent = pts.length ? `(${pts.length})` : '';
  [el.route, el.gpx, el.csv, el.clear].forEach(b => { b.disabled = !pts.length; });

  if (!pts.length) {
    el.list.innerHTML = '<li class="empty">Henüz kayıt yok</li>';
    return;
  }

  const frag = document.createDocumentFragment();
  for (const p of pts.slice(0, 500)) {
    const li = document.createElement('li');
    const l = mapLinks(p);
    const main = defaultMap(p);
    li.innerHTML = `
      <div class="when"></div>
      <div class="coords"></div>
      <div class="actions">
        <a class="btn main" target="_blank" rel="noopener"></a>
        <a class="btn" target="_blank" rel="noopener" href="${l.google}">Google</a>
        <a class="btn" target="_blank" rel="noopener" href="${l.apple}">Apple</a>
        <a class="btn" target="_blank" rel="noopener" href="${l.osm}">OSM</a>
        <button data-copy>Kopyala</button>
        <button data-del class="danger">Sil</button>
      </div>`;
    li.querySelector('.when').textContent = fmtTime(p.t);
    li.querySelector('.coords').textContent =
      `${fix(p.lat)}, ${fix(p.lng)} · ±${Math.round(p.acc)} m` +
      (p.alt != null ? ` · ${Math.round(p.alt)} m rakım` : '');
    const a = li.querySelector('a.main');
    a.href = main.href;
    a.textContent = main.name;
    li.querySelector('[data-copy]').onclick = async () => {
      try { await navigator.clipboard.writeText(`${fix(p.lat)}, ${fix(p.lng)}`); toast('Koordinat kopyalandı'); }
      catch { toast('Kopyalanamadı'); }
    };
    li.querySelector('[data-del]').onclick = async () => {
      if (!confirm('Bu kayıt silinsin mi?')) return;
      await deletePoint(p.id);
      render();
    };
    frag.appendChild(li);
  }
  if (pts.length > 500) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = `Son 500 kayıt gösteriliyor. Tamamı için GPX/CSV indirin.`;
    frag.appendChild(li);
  }
  el.list.replaceChildren(frag);
}

// ---------- Exports ----------
async function sortedAsc() {
  return (await allPoints()).sort((a, b) => a.t - b.t);
}

el.gpx.onclick = async () => {
  const pts = await sortedAsc();
  const trkpts = pts.map(p =>
    `      <trkpt lat="${p.lat}" lon="${p.lng}">` +
    (p.alt != null ? `<ele>${p.alt}</ele>` : '') +
    `<time>${new Date(p.t).toISOString()}</time></trkpt>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Konum Kaydedici" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Konum kayıtları</name><trkseg>
${trkpts}
  </trkseg></trk>
</gpx>`;
  download(`konum-${new Date().toISOString().slice(0, 10)}.gpx`, 'application/gpx+xml', gpx);
};

el.csv.onclick = async () => {
  const pts = await sortedAsc();
  const rows = ['zaman,enlem,boylam,dogruluk_m,rakim_m,hiz_ms',
    ...pts.map(p => [new Date(p.t).toISOString(), p.lat, p.lng, p.acc, p.alt ?? '', p.spd ?? ''].join(','))];
  download(`konum-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv', rows.join('\n'));
};

// Google Maps directions accept an origin, a destination and up to 9 waypoints,
// so the most recent points are thinned to fit.
el.route.onclick = async () => {
  let pts = (await sortedAsc()).slice(-200);
  pts = pts.filter((p, i) => i === 0 || haversine(pts[i - 1], p) > 20);
  if (pts.length < 2) {
    const p = (await sortedAsc()).pop();
    window.open(mapLinks(p).google, '_blank');
    return;
  }
  const max = 11;
  if (pts.length > max) {
    const step = (pts.length - 1) / (max - 1);
    pts = Array.from({ length: max }, (_, i) => pts[Math.round(i * step)]);
  }
  const ll = p => `${fix(p.lat)},${fix(p.lng)}`;
  const params = new URLSearchParams({
    api: '1', origin: ll(pts[0]), destination: ll(pts[pts.length - 1]), travelmode: 'walking',
  });
  const mid = pts.slice(1, -1).map(ll).join('|');
  if (mid) params.set('waypoints', mid);
  window.open(`https://www.google.com/maps/dir/?${params}`, '_blank');
};

el.clear.onclick = async () => {
  if (!confirm('Tüm kayıtlar kalıcı olarak silinsin mi?')) return;
  await clearPoints();
  render();
};

// ---------- Events ----------
el.toggle.onclick = () => (tracking ? stop() : start());
el.now.onclick = () => record();
el.interval.onchange = () => { save('interval', Number(el.interval.value)); updateStatus(); };
el.wake.onchange = () => {
  save('wake', el.wake.checked);
  el.wake.checked ? acquireWakeLock() : releaseWakeLock();
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  tick();
  acquireWakeLock();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
if (tracking) {
  timer = setInterval(tick, 5000);
  tick();
  acquireWakeLock();
}
updateStatus();
