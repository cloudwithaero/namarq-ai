// =============================================================================
// Namarq AI – Perfume SEO Generator  v3.0
// api/generate.js  (Vercel Serverless Function – ES Module)
// =============================================================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const rawName = (req.body?.name || "").toString().trim();
  if (!rawName) {
    return res.status(400).json({ error: "Perfume name is required." });
  }

  const OR_KEY = process.env.OPENROUTER_API_KEY;
  if (!OR_KEY) {
    return res.status(500).json({ error: "Server misconfiguration: API key missing." });
  }

  try {
    const name = normalizePerfumeName(rawName);
    const kbEntry = FRAGRANCE_KB[buildKey(name)] || null;

    const noteSystem = "You are a perfume expert. Return ONLY a raw JSON object. No prose, no markdown.";
    const notePrompt = `Provide the olfactory profile for "${name}".
    Return this JSON:
    {
      "canonical_name": "Full Name",
      "house": "Brand",
      "top": "notes",
      "heart": "notes",
      "base": "notes",
      "accords": "main accords",
      "gender": "Men|Women|Unisex",
      "concentration": "EDP|EDT|Parfum",
      "season": "seasons",
      "occasion": "occasions",
      "vibe": "3-5 adjectives",
      "longevity": "Moderate|Good|Excellent",
      "sillage": "Moderate|Strong"
    }`;

    const [rA, rB, rC] = await Promise.all([
      callModel(OR_KEY, "google/gemini-2.0-flash-exp:free", noteSystem, notePrompt, 0.1),
      callModel(OR_KEY, "mistralai/mistral-7b-instruct:free", noteSystem, notePrompt, 0.1),
      callModel(OR_KEY, "meta-llama/llama-3.1-8b-instruct:free", noteSystem, notePrompt, 0.1),
    ]);

    const pA = extractJSON(rA);
    const pB = extractJSON(rB);
    const pC = extractJSON(rC);

    let voted = semanticVote([pA, pB, pC], kbEntry, name);
    let profile = voted.profile;

    const finalName = profile.canonical_name || name;
    const house = profile.house || "Namarq";
    const slug = generateSlug(finalName);

    const seoSystem = "You are a luxury perfume copywriter for Namarq Egypt. Write poetic SEO content.";
    const seoPrompt = `Write SEO content for "${finalName}" by "${house}".
    Profile: ${JSON.stringify(profile)}
    Output exactly these sections:
    ## Short Description
    ## Meta Title
    ## Meta Description
    ## Product URL
    /product/${slug}
    ## SEO Tags`;

    const rSEO = await callModel(OR_KEY, "google/gemini-2.0-flash-exp:free", seoSystem, seoPrompt, 0.7);
    const seoText = extractText(rSEO) || buildFallbackSEO(finalName, house, profile, slug);

    return res.status(200).json({
      name: finalName,
      house,
      slug,
      confidence: voted.confidence,
      profile: {
        top: profile.top || "—",
        heart: profile.heart || "—",
        base: profile.base || "—",
        accords: profile.accords || "—",
        gender: profile.gender || "—",
        concentration: profile.concentration || "—",
        season: profile.season || "—",
        occasion: profile.occasion || "—",
        longevity: profile.longevity || "—",
        sillage: profile.sillage || "—",
        character: profile.vibe || "—",
      },
      seo: seoText,
    });

  } catch (err) {
    return res.status(500).json({ error: "Internal error", detail: err.message });
  }
}

async function callModel(apiKey, model, system, user, temperature) {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://namarq.store",
        "X-Title": "Namarq AI",
      },
      body: JSON.stringify({
        model, temperature, max_tokens: 1000,
        messages: [{ role: "system", content: system }, { role: "user", content: user }]
      }),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function extractJSON(apiResponse) {
  const raw = apiResponse?.choices?.[0]?.message?.content;
  if (!raw) return {};
  try { return JSON.parse(raw.trim()); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return {};
}

function extractText(apiResponse) {
  return apiResponse?.choices?.[0]?.message?.content?.trim() || null;
}

function semanticVote(profiles, kbEntry, inputName) {
  const valid = profiles.filter(p => Object.keys(p).length > 0);
  const fields = ["top", "heart", "base", "accords", "gender", "concentration", "season", "occasion", "vibe", "longevity", "sillage", "canonical_name", "house"];
  const merged = {};
  
  fields.forEach(f => {
    const vals = valid.map(p => p[f]).filter(Boolean);
    if (kbEntry && kbEntry[f]) vals.push(kbEntry[f]);
    if (vals.length === 0) { merged[f] = ""; return; }
    const counts = {};
    vals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    merged[f] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  });

  if (!merged.canonical_name) merged.canonical_name = inputName;
  return { profile: merged, confidence: valid.length > 1 ? "High" : "Medium" };
}

function normalizePerfumeName(n) {
  return n.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function buildKey(n) { return n.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function generateSlug(n) { return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function buildFallbackSEO(name, house, profile, slug) {
  return `## Short Description\n\nA fragrance by the house — opening with ${profile.top || "—"}, evolving through ${profile.heart || "—"}, and resting on a foundation of ${profile.base || "—"}.\n\n## Meta Title\n${name} — | Namarq Egypt\n\n## Meta Description\nShop ${name} at Namarq. fragrance. Free delivery in Egypt on orders over 1500 EGP.\n\n## Product URL\n/product/${slug}\n\n## SEO Tags\n${name}, perfume Egypt, Namarq`;
}

const FRAGRANCE_KB = {
  "creed": { canonical_name: "Creed Aventus", house: "Creed" },
  "creedaventus": { canonical_name: "Creed Aventus", house: "Creed" }
};
