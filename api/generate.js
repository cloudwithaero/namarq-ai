// =============================================================================
// Namarq AI – Perfume Engine v5 (Production)
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
    // ================= NAME FIX =================
    const name = smartNormalize(rawInput);

    // ================= CACHE =================
    const cacheKey = name.toLowerCase();
    if (CACHE.has(cacheKey)) {
      return res.status(200).json(CACHE.get(cacheKey));
    }

    // ================= KB =================
    let profile = KB[cacheKey] || null;

    // ================= SCRAPER =================
    if (!profile) {
      profile = await scrapeFragrantica(name, SCRAPER_KEY);
    }

    // ================= FALLBACK AI =================
    if (!profile || !profile.top) {
      profile = await aiFetch(name, OPENROUTER);
    }

    // ================= SAFE =================
    profile = sanitize(profile);

    // ================= VALIDATION =================
    const confidence = validate(profile);

    // ================= SEO =================
    const seo = await generateSEO(name, profile, OPENROUTER);

    const result = {
      name,
      confidence,
      profile,
      seo
    };

    CACHE.set(cacheKey, result);

    return res.status(200).json(result);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}


// ================= SMART NAME =================
function smartNormalize(name) {
  const fixes = {
    "dior suvage": "Dior Sauvage",
    "suvage": "Sauvage",
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
    const url = `https://www.fragrantica.com/search/?query=${encodeURIComponent(name)}`;

    const proxied = key
      ? `http://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(url)}`
      : url;

    const html = await (await fetch(proxied)).text();

    const match = html.match(/href="(\/perfume\/[^"]+)"/);
    if (!match) return null;

    const perfumeUrl = "https://www.fragrantica.com" + match[1];

    const page = await (await fetch(key
      ? `http://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(perfumeUrl)}`
      : perfumeUrl)).text();

    return {
      top: extract(page, "Top Notes"),
      heart: extract(page, "Middle Notes"),
      base: extract(page, "Base Notes")
    };

  } catch {
    return null;
  }
}

function extract(html, label) {
  const match = html.match(new RegExp(label + "[\\s\\S]{0,500}?</p>", "i"));
  if (!match) return "";
  return match[0].replace(/<[^>]*>/g, "").replace(label, "").trim();
}


// ================= AI FETCH =================
async function aiFetch(name, key) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [{
          role: "user",
          content: `Give perfume notes for ${name} in JSON`
        }]
      })
    });

    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);

  } catch {
    return {};
  }
}


// ================= VALIDATION =================
function validate(p) {
  let score = 0;
  if (p.top) score++;
  if (p.heart) score++;
  if (p.base) score++;
  return score >= 2 ? "High" : "Low";
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
    gender: s(p.gender, "Unisex")
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


// ================= KB =================
const KB = {
  "dior sauvage": {
    top: "Bergamot",
    heart: "Lavender, Pepper",
    base: "Ambroxan, Cedar"
  },
  "creed aventus": {
    top: "Pineapple, Bergamot",
    heart: "Birch, Jasmine",
    base: "Musk, Oakmoss"
  }
};
