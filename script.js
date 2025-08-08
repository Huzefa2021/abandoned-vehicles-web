/*************************************************
 * Abandoned Vehicles — Browser OCR + Geo Lookup
 * Huzefa — drop this in /script.js
 *************************************************/

/* ====== CONFIG: update only if your GeoJSON property keys differ ====== */
const GEO_PROPS = {
  ward:  'ward_name',        // e.g. 'Ward_Name'
  beat:  'beat_number',      // e.g. 'Beat_No'
  police:'police_station'    // e.g. 'Police_Station'
};

/* ====== UTIL: load local GeoJSON ====== */
async function loadGeoJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

/* ====== GEO: point-in-polygon using Turf ====== */
async function pointLookup(lat, lon, geojson, propName) {
  const pt = turf.point([lon, lat]); // GeoJSON order: [lon, lat]
  for (const feature of geojson.features) {
    try {
      if (turf.booleanPointInPolygon(pt, feature)) {
        const props = feature.properties || {};
        return (propName && props[propName] != null) ? String(props[propName]) : '';
      }
    } catch (e) {
      // Ignore malformed features
      console.warn('PIP error on feature:', e);
    }
  }
  return '';
}

/* ====== OCR TEXT CLEANUP & PARSING ====== */
function normalizeText(raw) {
  return raw
    .replace(/\u00B0/g, " ")         // degree symbol → space
    .replace(/[|“”‘’]/g, '"')        // curly quotes → plain
    .replace(/[^\S\r\n]+/g, " ")     // collapse spaces
    .trim();
}

function to24h(timeStr) {
  // Handles: "05:01 PM", "5:01 pm", "17:01", "05:01 PM GMT +05:30"
  const m = timeStr.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]\s*\.?\s*M)?/i);
  if (!m) return "";
  let hh = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = (m[3] || "").replace(/\s|\./g, "").toUpperCase(); // "AM" | "PM" | ""
  if (ampm === "PM" && hh < 12) hh += 12;
  if (ampm === "AM" && hh === 12) hh = 0;
  return `${String(hh).padStart(2,"0")}:${mm}`;
}

function extractDetailsFromText(rawText) {
  const text = normalizeText(rawText);
  const details = { date: "", time: "", lat: "", lon: "", address: "" };

  // 1) DATE — supports 2025-08-08 or 08/08/2025
  let m =
    text.match(/\b(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/) || // YYYY-MM-DD
    text.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/); // DD/MM/YYYY
  if (m) {
    const v = m[1].replace(/\./g, "-");
    if (/^\d{4}/.test(v)) {
      // Already YYYY-MM-DD
      details.date = v;
    } else {
      // Convert DD/MM/YYYY -> DD/MM/YYYY (keep this if your Form expects DD/MM/YYYY)
      const [d, mo, y] = v.split(/[\/\-]/);
      details.date = `${d.padStart(2,"0")}/${mo.padStart(2,"0")}/${y}`;
    }
  }

  // 2) TIME — capture with optional AM/PM; strip trailing GMT/zone
  m = text.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]\s*\.?\s*M)?)(?:\s*GMT.*)?\b/i);
  if (m) details.time = to24h(m[1]);

  // 3) COORDS — prefer explicit "Lat ... Long ..." first
  let latMatch = text.match(/Lat[^-\d]*(-?\d+(?:\.\d+)?)/i);
  let lonMatch = text.match(/Lo(?:ng|n)[^-\d]*(-?\d+(?:\.\d+)?)/i);
  if (latMatch && lonMatch) {
    details.lat = parseFloat(latMatch[1]);
    details.lon = parseFloat(lonMatch[1]);
  } else {
    // Fallback: nearest two decimals that look like lat/lon
    const nums = [...text.matchAll(/-?\d{1,3}\.\d{3,}/g)].map(m => parseFloat(m[0]));
    for (let i = 0; i + 1 < nums.length; i++) {
      const a = nums[i], b = nums[i+1];
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) { details.lat = a; details.lon = b; break; }
      if (Math.abs(b) <= 90 && Math.abs(a) <= 180) { details.lat = b; details.lon = a; break; }
    }
  }

  // 4) ADDRESS — quick heuristic: a line with "India" or "Mumbai"
  const lineWithIndia = text.split(/\r?\n/).find(l => /India/i.test(l) || /Mumbai/i.test(l));
  if (lineWithIndia) details.address = lineWithIndia.replace(/^\W+|\W+$/g, "");

  return details;
}

/* ====== UI STATE ====== */
let extracted = {
  date: '', time: '', lat: '', lon: '', address: '',
  ward: '', beat: '', police: ''
};

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

  // enable submit only if we have lat/lon
  const canSend = extracted.lat && extracted.lon;
  document.getElementById('sendToFormBtn').disabled = !canSend;
}

/* ====== MAIN: Process Photo (OCR + Parse + Geo lookups) ====== */
document.getElementById('processBtn').addEventListener('click', async () => {
  const file = document.getElementById('photoInput').files[0];
  if (!file) { alert("Please select a photo"); return; }

  try {
    // ——— OCR with BOOSTED settings ———
    const { data: { text } } = await Tesseract.recognize(file, 'eng', {
      logger: m => console.log(m),   // progress in console
      tessedit_pageseg_mode: 6,      // one uniform block of text
      preserve_interword_spaces: '1',
      user_defined_dpi: '300'
    });

    document.getElementById('ocrText').textContent = text;

    // Parse OCR to fields
    const details = extractDetailsFromText(text);

    // Geo lookups (only if coords found)
    if (details.lat && details.lon) {
      const [wards, beats, police] = await Promise.all([
        loadGeoJSON('data/wards.geojson'),
        loadGeoJSON('data/beats.geojson'),
        loadGeoJSON('data/police_jurisdiction.geojson')
      ]);

      details.ward   = await pointLookup(details.lat, details.lon, wards,  GEO_PROPS.ward);
      details.beat   = await pointLookup(details.lat, details.lon, beats,  GEO_PROPS.beat);
      details.police = await pointLookup(details.lat, details.lon, police, GEO_PROPS.police);
    }

    extracted = details;
    updateUIFromExtracted();

  } catch (err) {
    console.error(err);
    alert("Error during processing. Open the console (F12) for details.");
  }
});

/* ====== SUBMIT to Google Form (hidden POST) ====== */
document.getElementById('sendToFormBtn').addEventListener('click', () => {
  try {
    document.getElementById('g_date').value    = extracted.date || '';
    document.getElementById('g_time').value    = extracted.time || '';
    document.getElementById('g_lat').value     = extracted.lat  || '';
    document.getElementById('g_lon').value     = extracted.lon  || '';
    document.getElementById('g_ward').value    = extracted.ward || '';
    document.getElementById('g_beat').value    = extracted.beat || '';
    document.getElementById('g_address').value = extracted.address || '';
    document.getElementById('g_police').value  = extracted.police || '';
    document.getElementById('gform').submit();
    alert('Submitted to Google Form ✅');
  } catch (e) {
    console.error(e);
    alert('Could not submit to Google Form. Check console.');
  }
});
