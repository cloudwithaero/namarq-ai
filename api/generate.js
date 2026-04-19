// =============================================================================
// Namarq AI – Perfume SEO Generator  v3.1
// api/generate.js  (Vercel Serverless Function – ES Module)
// =============================================================================

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const rawName = (req.body?.name || "").toString().trim();
  if (!rawName) return res.status(400).json({ error: "Perfume name is required." });

  const OR_KEY = process.env.OPENROUTER_API_KEY;
  if (!OR_KEY) return res.status(500).json({ error: "API key missing." });

  try {
    const name = rawName
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

    // ── STAGE 1: Olfactory Profile Extraction ─────────────────────────────
    const prompt = `You are a fragrance database expert. Extract the olfactory profile for the perfume "${name}".

CRITICAL RULES:
- Respond ONLY with the key-value pairs below, nothing else
- No markdown, no bold, no asterisks, no bullet points, no extra lines
- Use exactly this format: KEY: value
- If unsure, make a reasonable guess — never leave a value empty

CANONICAL_NAME: ${name}
HOUSE: [brand/house name]
TOP: [top notes, comma separated]
HEART: [heart notes, comma separated]
BASE: [base notes, comma separated]
ACCORDS: [main accords, comma separated]
GENDER: [Men / Women / Unisex]
CONCENTRATION: [EDP / EDT / Parfum / EDC]
SEASON: [seasons, comma separated]
OCCASION: [occasions, comma separated]
VIBE: [3-5 descriptive adjectives]
LONGEVITY: [Weak / Moderate / Good / Excellent]
SILLAGE: [Soft / Moderate / Strong / Beast]`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OR_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://namarq.store",
        "X-Title": "Namarq AI",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        temperature: 0.1,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || "";

    // ── Robust Parser ──────────────────────────────────────────────────────
    // Handles: markdown bold (**KEY:**), bullets (- KEY:), extra whitespace,
    // colons inside values, and keys with spaces (e.g. "CANONICAL NAME")
    const profile = {};
    const lines = text.split("\n");

    lines.forEach((line) => {
      // Strip markdown: bold markers, leading dashes/bullets, extra spaces
      const cleaned = line
        .replace(/\*\*/g, "")
        .replace(/^[\s\-•*]+/, "")
        .trim();

      if (!cleaned) return;

      const colonIdx = cleaned.indexOf(":");
      if (colonIdx === -1) return;

      const rawKey = cleaned.slice(0, colonIdx).trim();
      const val = cleaned.slice(colonIdx + 1).trim();

      // Normalize key: uppercase + spaces → underscores
      const key = rawKey.toUpperCase().replace(/\s+/g, "_");

      // Skip empty or placeholder values
      if (!key || !val || val === "—" || val === "-" || val === "") return;

      profile[key] = val;
    });

    // ── Confidence Check ───────────────────────────────────────────────────
    const filledFields = ["TOP", "HEART", "BASE", "ACCORDS", "GENDER"].filter(
      (k) => profile[k] && profile[k] !== "—"
    ).length;
    const confidence = filledFields >= 3 ? "high" : filledFields >= 1 ? "medium" : "low";

    const finalName = profile.CANONICAL_NAME || name;
    const house = profile.HOUSE || "Namarq";
    const slug = finalName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // ── STAGE 2: SEO Generation ────────────────────────────────────────────
    const profileSummary = [
      profile.TOP && `Top: ${profile.TOP}`,
      profile.HEART && `Heart: ${profile.HEART}`,
      profile.BASE && `Base: ${profile.BASE}`,
      profile.ACCORDS && `Accords: ${profile.ACCORDS}`,
      profile.GENDER && `Gender: ${profile.GENDER}`,
      profile.SEASON && `Season: ${profile.SEASON}`,
    ]
      .filter(Boolean)
      .join(". ");

    const seoPrompt = `Write luxury perfume SEO content for "${finalName}" by ${house}.
Profile: ${profileSummary}

Output exactly these 5 sections with these exact headers (no extra text before or after):

## Short Description
[2-3 sentences, evocative luxury language, mention key notes]

## Meta Title
[format: ${finalName} – ${house} | Namarq Egypt, under 60 chars]

## Meta Description
[155 chars max, include key notes + call to action, mention Namarq Egypt]

## Product URL
/product/${slug}

## SEO Tags
[10-15 comma separated tags: fragrance name, notes, brand, "perfume Egypt", "buy ${finalName} Egypt", etc.]`;

    const seoResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OR_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://namarq.store",
        "X-Title": "Namarq AI",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        temperature: 0.7,
        messages: [{ role: "user", content: seoPrompt }],
      }),
    });

    const seoData = await seoResponse.json();
    const seoText =
      seoData?.choices?.[0]?.message?.content ||
      buildFallbackSEO(finalName, house, profile, slug);

    // ── Final Response ─────────────────────────────────────────────────────
    return res.status(200).json({
      name: finalName,
      house,
      slug,
      confidence,
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
      // Debug: remove this in production if you want
      _debug: {
        rawText: text,
        parsedKeys: Object.keys(profile),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal Server Error", detail: err.message });
  }
}

function buildFallbackSEO(name, house, profile, slug) {
  const top = profile.TOP || "citrus and spice";
  const heart = profile.HEART || "floral and woody accords";
  const base = profile.BASE || "musk and amber";

  return `## Short Description

${name} by ${house} opens with ${top}, blossoming into a heart of ${heart}, before settling into a warm foundation of ${base}. A captivating fragrance that commands attention and leaves a lasting impression.

## Meta Title
${name} – ${house} | Namarq Egypt

## Meta Description
Shop ${name} by ${house} at Namarq Egypt. Featuring ${top}. Free delivery on orders over 1500 EGP. Authentic fragrance guaranteed.

## Product URL
/product/${slug}

## SEO Tags
${name}, ${name} perfume, ${house} fragrance, buy ${name} Egypt, ${name} Namarq, perfume Egypt, luxury fragrance Egypt, ${top}, ${base}, Namarq Egypt`;
}
