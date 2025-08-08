function normalizeText(raw) {
  return raw
    .replace(/\u00B0/g, " ")        // ° -> space
    .replace(/[|“”‘’]/g, '"')       // fancy quotes to plain
    .replace(/[^\S\r\n]+/g, " ")    // collapse multiple spaces
    .replace(/[^\x00-\x7F]/g, c => c) // keep as-is; we mostly stripped above
    .trim();
}

function to24h(timeStr) {
  // Handles: 05:01 PM, 5:01 pm, 17:01, 05:01 PM GMT +05:30, etc.
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s*([AP]\s*\.?\s*M)?/i);
  if (!m) return "";
  let hh = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = (m[3] || "").replace(/\s|\./g, "").toUpperCase(); // AM/PM or ""
  if (ampm === "PM" && hh < 12) hh += 12;
  if (ampm === "AM" && hh === 12) hh = 0;
  return `${String(hh).padStart(2,"0")}:${mm}`;
}

function extractDetailsFromText(rawText) {
  const text = normalizeText(rawText);
  const details = { date: "", time: "", lat: "", lon: "", address: "" };

  // 1) DATE — allow 08/08/2025, 8/8/2025, 2025-08-08, etc.
  let m =
    text.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/) ||
    text.match(/\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/);
  if (m) {
    // Normalize to YYYY-MM-DD or DD/MM/YYYY as needed by your Form
    const v = m[1];
    if (/^\d{4}/.test(v)) {
      // YYYY-MM-DD
      details.date = v.replace(/\./g, "-");
    } else {
      // DD/MM/YYYY
      const [d, mo, y] = v.split(/[\/\-\.]/);
      details.date = `${d.padStart(2,"0")}/${mo.padStart(2,"0")}/${y}`;
    }
  }

  // 2) TIME — capture with AM/PM if present
  m = text.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]\s*\.?\s*M)?)(?:\s*GMT.*)?\b/i);
  if (m) details.time = to24h(m[1]);

  // 3) COORDS — robust for "Lat 19.112863 Long 72.87933", with junk in between
  // Try explicit Lat/Long first
  let latMatch = text.match(/Lat[^-\d]*(-?\d+(?:\.\d+)?)/i);
  let lonMatch = text.match(/Lo(?:ng|n)[^-\d]*(-?\d+(?:\.\d+)?)/i);
  if (latMatch && lonMatch) {
    details.lat = parseFloat(latMatch[1]);
    details.lon = parseFloat(lonMatch[1]);
  } else {
    // Fallback: two decimals close to each other (assume lat then lon)
    const nums = [...text.matchAll(/-?\d{1,3}\.\d{3,}/g)].map(m => parseFloat(m[0]));
    for (let i = 0; i + 1 < nums.length; i++) {
      const a = nums[i], b = nums[i+1];
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
        details.lat = a; details.lon = b; break;
      }
      if (Math.abs(b) <= 90 && Math.abs(a) <= 180) {
        details.lat = b; details.lon = a; break;
      }
    }
  }

  // 4) ADDRESS — grab the line containing "India" or "Mumbai" and trim
  // (You can refine this later)
  const lineWithIndia = text.split(/\r?\n/).find(l => /India/i.test(l) || /Mumbai/i.test(l));
  if (lineWithIndia) {
    details.address = lineWithIndia.replace(/^\W+|\W+$/g, "");
  }

  return details;
}
