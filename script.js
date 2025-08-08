/*************************************************
 * Abandoned Vehicles — Browser OCR + Geo Lookup
 * DEBUG + Prefill Redirect version
 *************************************************/

/* ====== SETTINGS ====== */
const DEBUG = true;                  // set false to silence console logs
const OPEN_IN_NEW_TAB = true;        // open prefill in new tab instead of same tab

// Your Google Form IDs (confirmed)
const FORM_BASE = 'https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform';
const ENTRY = {
  date:    'entry.1911996449',
  time:    'entry.1421115881',
  lat:     'entry.113122688',    // 1
  lon:     'entry.419288992',    // 2
  ward:    'entry.1625337207',   // 3
  beat:    'entry.1058310891',   // 4
  address: 'entry.1188611077',   // 5
  police:  'entry.1555105834'    // 6
};

// GeoJSON property keys (change if your files use different names)
const GEO_PROPS = {
  ward:  'ward_name',
  beat:  'beat_number',
  police:'police_station'
};

/* ====== Small debug helpers ====== */
function log(...args){ if(DEBUG) console.log('[AV]', ...args); }
function warn(...args){ if(DEBUG) console.warn('[AV]', ...args); }
function err(...args){ if(DEBUG) console.error('[AV]', ...args); }

function setStatus(text){
  let el = document.getElementById('statusText');
  if(!el){
    el = document.createElement('div');
    el.id = 'statusText';
    el.style.cssText = 'margin:8px 0;padding:8px;background:#fff3cd;border:1px solid #ffeeba;border-radius:6px;font:14px/1.4 system-ui;';
    const btn = document.getElementById('processBtn');
    btn && btn.insertAdjacentElement('afterend', el);
  }
  el.textContent = text;
}

/* ====== UTIL ====== */
async function loadGeoJSON(url) {
  log('Loading GeoJSON:', url);
  const t0 = performance.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const json = await res.json();
  log(`Loaded ${url} in ${(performance.now()-t0).toFixed(0)}ms`);
  return json;
}

async function pointLookup(lat, lon, geojson, propName) {
  const pt = turf.point([lon, lat]); // [lon,lat]
  for (const feature of geojson.features) {
    try {
      if (turf.booleanPointInPolygon(pt, feature)) {
        const props = feature.properties || {};
        return (propName && props[propName] != null) ? String(props[propName]) : '';
      }
    } catch (e) { warn('PIP error on feature:', e); }
  }
  return '';
}

/* ====== IMAGE: downscale before OCR ====== */
async function downscaleImage(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = function(){
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.85);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ====== OCR TEXT CLEANUP & PARSING ====== */
function normalizeText(raw) {
  return raw
    .replace(/\u00B0/g, " ")
    .replace(/[|“”‘’]/g, '"')
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
}
function to24h(timeStr) {
  const m = timeStr.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]\s*\.?\s*M)?/i);
  if (!m) return "";
  let hh = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = (m[3] || "").replace(/\s|\./g, "").toUpperCase();
  if (ampm === "PM" && hh < 12) hh += 12;
  if (ampm === "AM" && hh === 12) hh = 0;
  return `${String(hh).padStart(2,"0")}:${mm}`;
}
function extractDetailsFromText(rawText) {
  const text = normalizeText(rawText);
  const details = { date: "", time: "", lat: "", lon: "", address: "" };

  // Date: prefer YYYY-MM-DD (matches your sample prefill)
  let m = text.match(/\b(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/) ||  // YYYY-MM-DD
          text.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/);  // DD/MM/YYYY
  if (m) {
    const v = m[1].replace(/\./g,'-');
    if (/^\d{4}/.test(v)) {
      details.date = v.replace(/\//g,'-'); // YYYY-MM-DD
    } else {
      const [d, mo, y] = v.split(/[\/\-\.]/);
      const yyyy = (y.length === 2) ? ('20' + y) : y;
      details.date = `${yyyy}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
  }

  // Time (to 24h HH:MM)
  m = text.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]\s*\.?\s*M)?)(?:\s*GMT.*)?\b/i);
  if (m) details.time = to24h(m[1]);

  // Coords: prefer explicit Lat / Long first
  let latMatch = text.match(/Lat[^-\d]*(-?\d+(?:\.\d+)?)/i);
  let lonMatch = text.match(/Lo(?:ng|n)[^-\d]*(-?\d+(?:\.\d+)?)/i);
  if (latMatch && lonMatch) {
    details.lat = parseFloat(latMatch[1]);
    details.lon = parseFloat(lonMatch[1]);
  } else {
    // fallback: first two decimals close together
    const nums = [...text.matchAll(/-?\d{1,3}\.\d{3,}/g)].map(x => parseFloat(x[0]));
    for (let i=0; i+1<nums.length; i++){
      const a = nums[i], b = nums[i+1];
      if (Math.abs(a)<=90 && Math.abs(b)<=180){ details.lat=a; details.lon=b; break; }
      if (Math.abs(b)<=90 && Math.abs(a)<=180){ details.lat=b; details.lon=a; break; }
    }
  }

  // Address heuristic
  const lineWithIndia = text.split(/\r?\n/).find(l => /India|Mumbai/i.test(l));
  if (lineWithIndia) details.address = lineWithIndia.replace(/^\W+|\W+$/g,'');

  return details;
}

/* ====== UI STATE ====== */
let extracted = { date:'', time:'', lat:'', lon:'', address:'', ward:'', beat:'', police:'' };

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = (val ?? '');
}
function updateUIFromExtracted() {
  setText('dateOut', extracted.date);
  setText('timeOut', extracted.time);
  setText('latOut', extracted.lat);
  setText('lonOut', extracted.lon);
  setText('wardOut', extracted.ward);
  setText('beatOut', extracted.beat);
  setText('addressOut', extracted.address);
  setText('policeOut', extracted.police);
  document.getElementById('sendToFormBtn').disabled = !(extracted.lat && extracted.lon);
}

/* ====== Google Form Prefill ====== */
function buildPrefillUrl(vals){
  const qs = new URLSearchParams({
    [ENTRY.date]:    vals.date    || '',
    [ENTRY.time]:    vals.time    || '',
    [ENTRY.lat]:     String(vals.lat ?? ''),
    [ENTRY.lon]:     String(vals.lon ?? ''),
    [ENTRY.ward]:    vals.ward    || '',
    [ENTRY.beat]:    vals.beat    || '',
    [ENTRY.address]: vals.address || '',
    [ENTRY.police]:  vals.police  || ''
  });
  return `${FORM_BASE}?${qs.toString()}`;
}

/* ====== MAIN: Process Photo ====== */
document.getElementById('processBtn').addEventListener('click', async () => {
  const file = document.getElementById('photoInput').files[0];
  if (!file) { alert('Please select a photo'); return; }

  const btn = document.getElementById('processBtn');
  try {
    btn.disabled = true; btn.textContent = 'Processing…';
    setStatus('Step 1/4: Downscaling image…');
    console.groupCollapsed('AV Debug: Processing');

    // 1) Downscale
    console.time('Downscale');
    const scaledBlob = await downscaleImage(file, 1600);
    console.timeEnd('Downscale');
    log('Scaled size ~', Math.round((scaledBlob.size/1024)),'KB');

    // 2) OCR
    setStatus('Step 2/4: Running OCR… (first time may take ~10–15s)');
    console.time('OCR');
    const { data: { text } } = await Tesseract.recognize(scaledBlob, 'eng', {
      logger: m => { if (DEBUG) console.log('[AV][Tess]', m); setStatus(`Step 2/4: OCR… ${Math.round((m.progress||0)*100)}%`); },
      tessedit_pageseg_mode: 6,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
      workerPath: 'https://unpkg.com/tesseract.js@4.0.2/dist/worker.min.js',
      langPath:   'https://tessdata.projectnaptha.com/4.0.0',
      corePath:   'https://unpkg.com/tesseract.js-core@4.0.2/tesseract-core.wasm.js'
    });
    console.timeEnd('OCR');
    document.getElementById('ocrText').textContent = text;

    // 3) Parse OCR
    setStatus('Step 3/4: Parsing text…');
    console.time('Parse');
    const details = extractDetailsFromText(text);
    console.timeEnd('Parse');
    log('Parsed:', details);

    // 4) Geo lookups
    if (details.lat && details.lon) {
      setStatus('Step 4/4: Geo lookups (Ward/Beat/Police)…');
      console.time('Geo');
      const [wards, beats, police] = await Promise.all([
        loadGeoJSON('data/wards.geojson'),
        loadGeoJSON('data/beats.geojson'),
        loadGeoJSON('data/police_jurisdiction.geojson')
      ]);
      details.ward   = await pointLookup(details.lat, details.lon, wards,  GEO_PROPS.ward);
      details.beat   = await pointLookup(details.lat, details.lon, beats,  GEO_PROPS.beat);
      details.police = await pointLookup(details.lat, details.lon, police, GEO_PROPS.police);
      console.timeEnd('Geo');
    } else {
      warn('No coordinates parsed; skipping geo lookups.');
    }

    extracted = details;
    updateUIFromExtracted();

    // Prefill redirect
    const prefillUrl = buildPrefillUrl(extracted);
    log('Prefill URL:', prefillUrl);
    setStatus('Done ✅ Redirecting to Google Form…');
    if (OPEN_IN_NEW_TAB) {
      window.open(prefillUrl, '_blank');
    } else {
      window.location.href = prefillUrl;
    }

  } catch (e) {
    err(e);
    setStatus('❌ Error — open Console (F12) for details.');
    alert('Processing failed. Check Console (F12) → "AV Debug: Processing".');
  } finally {
    btn.disabled = false; btn.textContent = 'Process Photo';
    console.groupEnd('AV Debug: Processing');
  }
});

/* ====== (Optional) Keep the old Submit button to POST hidden form if you ever need it ====== */
document.getElementById('sendToFormBtn').addEventListener('click', () => {
  const url = buildPrefillUrl(extracted);
  if (OPEN_IN_NEW_TAB) window.open(url, '_blank'); else window.location.href = url;
});
