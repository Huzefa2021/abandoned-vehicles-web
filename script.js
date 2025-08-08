async function loadGeoJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function pointLookup(lat, lon, geojson, propName) {
  const pt = turf.point([lon, lat]); // GeoJSON order: [lon, lat]
  for (const feature of geojson.features) {
    if (turf.booleanPointInPolygon(pt, feature)) {
      return (feature.properties && feature.properties[propName]) || '';
    }
  }
  return '';
}

function extractDetailsFromText(text) {
  const details = {};

  // Date formats: 2025-08-08 or 08/08/2025 etc. (tweak if your photos differ)
  let m;
  m = text.match(/\b(\d{4}[-/]\d{2}[-/]\d{2})\b/) || text.match(/\b(\d{2}[-/]\d{2}[-/]\d{4})\b/);
  details.date = m ? m[1].replace(/\./g,'-') : '';

  // Time formats: 19:49 or 19:49:30 (24h)
  m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
  details.time = m ? `${m[1]}:${m[2]}` : '';

  // Coordinates: decimal lat lon in same line, e.g., 18.9321 72.8347  (we’ll assume lat first)
  m = text.match(/(-?\d{1,3}\.\d+)[ ,]+(-?\d{1,3}\.\d+)/);
  if (m) {
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    // Heuristic: latitude is between -90..90; longitude -180..180
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
      details.lat = a;
      details.lon = b;
    } else if (Math.abs(b) <= 90 && Math.abs(a) <= 180) {
      details.lat = b;
      details.lon = a;
    }
  }

  // (Start simple) Leave address blank for now; we can improve later
  details.address = '';

  return details;
}

let extracted = {
  date: '', time: '', lat: '', lon: '', address: '',
  ward: '', beat: '', police: ''
};

document.getElementById('processBtn').addEventListener('click', async () => {
  const file = document.getElementById('photoInput').files[0];
  if (!file) { alert("Please select a photo"); return; }

  // OCR
  const { data: { text } } = await Tesseract.recognize(file, 'eng');
  document.getElementById('ocrText').textContent = text;

  // Parse
  const details = extractDetailsFromText(text);

  // Geo lookups if we have coordinates
  if (details.lat && details.lon) {
    const wards  = await loadGeoJSON('data/wards.geojson');
    const beats  = await loadGeoJSON('data/beats.geojson');
    const police = await loadGeoJSON('data/police_jurisdiction.geojson');

    details.ward   = await pointLookup(details.lat, details.lon, wards,  'ward_name');      // adjust prop names if needed
    details.beat   = await pointLookup(details.lat, details.lon, beats,  'beat_number');
    details.police = await pointLookup(details.lat, details.lon, police, 'police_station');
  }

  extracted = details;

  // Show on screen
  document.getElementById('dateOut').textContent = details.date || '';
  document.getElementById('timeOut').textContent = details.time || '';
  document.getElementById('latOut').textContent  = details.lat  || '';
  document.getElementById('lonOut').textContent  = details.lon  || '';
  document.getElementById('wardOut').textContent = details.ward || '';
  document.getElementById('beatOut').textContent = details.beat || '';
  document.getElementById('addressOut').textContent = details.address || '';
  document.getElementById('policeOut').textContent  = details.police || '';

  // Enable submit to Google Form once we have lat/lon
  document.getElementById('sendToFormBtn').disabled = !(details.lat && details.lon);
});

document.getElementById('sendToFormBtn').addEventListener('click', () => {
  // Map to your Google Form ids
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
});
