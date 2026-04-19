// =============================================================================
// Namarq AI – Perfume SEO Generator  v3.0
// api/generate.js  (Vercel Serverless Function – ES Module)
// =============================================================================

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const rawName = (req.body?.name || "").toString().trim();
  if (!rawName) return res.status(400).json({ error: "Perfume name is required." });

  const OR_KEY = process.env.OPENROUTER_API_KEY;
  if (!OR_KEY) return res.status(500).json({ error: "API key missing." });

  try {
    const name = rawName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    
    // ── STAGE 1: Ultra-Stable Extraction ─────────────────────────────────────
    // We ask for a simple key-value format to avoid JSON parsing errors
    const prompt = `Provide the olfactory profile for "${name}". 
    Format your response EXACTLY like this list:
    CANONICAL_NAME: [Full Name]
    HOUSE: [Brand]
    TOP: [notes]
    HEART: [notes]
    BASE: [notes]
    ACCORDS: [main accords]
    GENDER: [Men/Women/Unisex]
    CONCENTRATION: [EDP/EDT/Parfum]
    SEASON: [seasons]
    OCCASION: [occasions]
    VIBE: [3-5 adjectives]
    LONGEVITY: [Moderate/Good/Excellent]
    SILLAGE: [Moderate/Strong]`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OR_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://namarq.store",
        "X-Title": "Namarq AI",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        temperature: 0.1,
        messages: [{ role: "user", content: prompt }]
      }),
    });

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || "";
    
    // Parse the custom format
    const profile = {};
    const lines = text.split('\n');
    lines.forEach(line => {
      const [key, ...val] = line.split(':');
      if (key && val.length > 0) {
        profile[key.trim().toUpperCase()] = val.join(':').trim();
      }
    });

    const finalName = profile.CANONICAL_NAME || name;
    const house = profile.HOUSE || "Namarq";
    const slug = finalName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // ── STAGE 2: SEO Generation ──────────────────────────────────────────────
    const seoPrompt = `Write luxury SEO content for "${finalName}" by "${house}".
    Notes: ${profile.TOP}, ${profile.HEART}, ${profile.BASE}.
    Output exactly these headers:
    ## Short Description
    ## Meta Title
    ## Meta Description
    ## Product URL
    /product/${slug}
    ## SEO Tags`;

    const seoResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OR_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        temperature: 0.7,
        messages: [{ role: "user", content: seoPrompt }]
      }),
    });

    const seoData = await seoResponse.json();
    const seoText = seoData?.choices?.[0]?.message?.content || buildFallbackSEO(finalName, house, profile, slug);

    // ── Final Response ───────────────────────────────────────────────────────
    return res.status(200).json({
      name: finalName,
      house,
      slug,
      profile: {
        top: profile.TOP || "—",
        heart: profile.HEART || "—",
        base: profile.BASE || "—",
        accords: profile.ACCORDS || "—",
        gender: profile.GENDER || "—",
        concentration: profile.CONCENTRATION || "—",
        season: profile.SEASON || "—",
        occasion: profile.OCCASION || "—",
        longevity: profile.LONGEVITY || "—",
        sillage: profile.SILLAGE || "—",
        character: profile.VIBE || "—",
      },
      seo: seoText,
    });

  } catch (err) {
    return res.status(500).json({ error: "Error", detail: err.message });
  }
}

function buildFallbackSEO(name, house, profile, slug) {
  return `## Short Description\n\nA fragrance by the house — opening with ${profile.TOP || "—"}, evolving through ${profile.HEART || "—"}, and resting on a foundation of ${profile.BASE || "—"}.\n\n## Meta Title\n${name} — | Namarq Egypt\n\n## Meta Description\nShop ${name} at Namarq. fragrance. Free delivery in Egypt on orders over 1500 EGP.\n\n## Product URL\n/product/${slug}\n\n## SEO Tags\n${name}, perfume Egypt, Namarq`;
}
