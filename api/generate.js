// =============================================================================
// Namarq AI – Perfume Engine v4 (Scraper + SEO AI)
// =============================================================================

const CACHE = new Map();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const rawInput = (req.body?.name || "").toString().trim();
  if (!rawInput) {
    return res.status(400).json({ error: "Perfume name required" });
  }

  const OPENROUTER = process.env.OPENROUTER_API_KEY;
  const SCRAPER_KEY = process.env.SCRAPER_API_KEY;

  try {
    const name = normalizeName(rawInput);
    const cacheKey = name.toLowerCase();

    // ================= CACHE =================
    if (CACHE.has(cacheKey)) {
      return res.status(200).json(CACHE.get(cacheKey));
    }

    // ================= SCRAPE =================
    let profile = await scrapeFragrantica(name, SCRAPER_KEY);

    // ================= FALLBACK =================
    if (!profile || !profile.top) {
      profile = fallbackProfile();
    }

    profile = sanitize(profile);

    // ================= SEO =================
    const seo = await generateSEO(name, profile, OPENROUTER);

    const result = {
      name,
      confidence: profile.top ? "High" : "Low",
      profile,
      seo
    };

    CACHE.set(cacheKey, result);

    return res.status(200).json(result);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ================= NAME FIX =================
function normalizeName(name) {
  const fixes = {
    "dior suvage": "Dior Sauvage",
    "suvage": "Dior Sauvage",
    "creed": "Creed Aventus"
  };

  let clean = name.toLowerCase();

  Object.keys(fixes).forEach(k => {
    if (clean.includes(k)) {
      clean = clean.replace(k, fixes[k]);
    }
  });

  return clean.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ================= SCRAPER =================
async function scrapeFragrantica(name, key) {
  try {
    const searchUrl = `https://www.fragrantica.com/search/?query=${encodeURIComponent(name)}`;

    const searchHtml = await (await fetch(proxy(searchUrl, key))).text();

    const match = searchHtml.match(/href="(\/perfume\/[^"]+)"/);
    if (!match) return null;

    const perfumeUrl = "https://www.fragrantica.com" + match[1];

    const html = await (await fetch(proxy(perfumeUrl, key))).text();

    return parseFragrantica(html, perfumeUrl);

  } catch {
    return null;
  }
}

function proxy(url, key) {
  return key
    ? `http://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(url)}`
    : url;
}

// ================= PARSER =================
function parseFragrantica(html, url) {
  const profile = {};

  // NAME
  const title = html.match(/<title>([^|<]+)/i);
  if (title) profile.name = decode(title[1]);

  // HOUSE
  const houseMatch = url.match(/\/perfume\/([^/]+)\//);
  if (houseMatch) {
    profile.house = decode(houseMatch[1].replace(/-/g, " "));
  }

  // NOTES
  profile.top = extractNotes(html, "top");
  profile.heart = extractNotes(html, "middle");
  profile.base = extractNotes(html, "base");

  // ACCORDS
  const accords = [...html.matchAll(/class="accord[^"]*">\s*([^<]+)</gi)]
    .map(m => decode(m[1]))
    .slice(0, 6);

  if (accords.length) profile.accords = accords.join(", ");

  // GENDER
  if (/for men/i.test(html)) profile.gender = "Men";
  if (/for women/i.test(html)) profile.gender = "Women";
  if (/for women and men/i.test(html)) profile.gender = "Unisex";

  // LONGEVITY
  const lon = html.match(/longevity[\s\S]{0,200}?(weak|moderate|long lasting|very long)/i);
  if (lon) profile.longevity = capitalize(lon[1]);

  // SILLAGE
  const sil = html.match(/sillage[\s\S]{0,200}?(soft|moderate|strong|enormous)/i);
  if (sil) profile.sillage = capitalize(sil[1]);

  return profile;
}

function extractNotes(html, type) {
  const section = html.match(new RegExp(type + " notes?[\\s\\S]{0,1200}", "i"));
  if (!section) return "";

  const notes = [...section[0].matchAll(/title="([^"]+)"/g)]
    .map(m => m[1])
    .slice(0, 10);

  return notes.join(", ");
}

// ================= HELPERS =================
function decode(str) {
  return str.replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ================= FALLBACK =================
function fallbackProfile() {
  return {
    top: "Citrus, Fresh",
    heart: "Aromatic, Spicy",
    base: "Woody, Musk",
    accords: "Fresh, Woody",
    gender: "Unisex",
    longevity: "Moderate",
    sillage: "Moderate"
  };
}

// ================= SANITIZE =================
function sanitize(p) {
  function s(v, f) {
    return v && v.trim() ? v : f;
  }

  return {
    top: s(p.top, "Citrus, Fresh"),
    heart: s(p.heart, "Aromatic, Spicy"),
    base: s(p.base, "Woody, Musk"),
    accords: s(p.accords, "Fresh, Woody"),
    gender: s(p.gender, "Unisex"),
    longevity: s(p.longevity, "Moderate"),
    sillage: s(p.sillage, "Moderate")
  };
}

// ================= SEO =================
async function generateSEO(name, p, key) {
  const prompt = `
Write luxury perfume SEO.

Perfume: ${name}
Top: ${p.top}
Heart: ${p.heart}
Base: ${p.base}
Accords: ${p.accords}

Return:
Short Description (max 160 chars)
Meta Title
Meta Description
`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await res.json();
    return data.choices[0].message.content;

  } catch {
    return "SEO generation failed";
  }
}
