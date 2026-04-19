// =============================================================================
// Namarq AI – Perfume SEO Generator  v3.0
// api/generate.js  (Vercel Serverless Function – ES Module)
// =============================================================================

export default async function handler(req, res) {
  console.log("[namarq-ai] Request received:", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const rawName = (req.body?.name || "").toString().trim();
  if (!rawName) {
    return res.status(400).json({ error: "Perfume name is required." });
  }

  const OR_KEY = process.env.OPENROUTER_API_KEY;
  if (!OR_KEY) {
    console.error("[namarq-ai] API Key missing");
    return res.status(500).json({ error: "Server misconfiguration: API key missing." });
  }

  try {
    // ── STAGE 0: Normalize + KB seed ─────────────────────────────────────────
    const name    = normalizePerfumeName(rawName);
    const kbEntry = FRAGRANCE_KB[buildKey(name)] || null;
    console.log("[namarq-ai] Normalized name:", name, "KB Entry found:", !!kbEntry);

    // ── STAGE 1: Triple-model parallel extraction ─────────────────────────────
    const noteSystem =
      "You are an expert perfume database. Return ONLY a raw JSON object. " +
      "No markdown, no backticks. Be precise.";

    const notePrompt = buildNotePrompt(name, kbEntry);

    console.log("[namarq-ai] Calling models in parallel...");
    const [rA, rB, rC] = await Promise.all([
      callModel(OR_KEY, "google/gemini-2.0-flash-exp:free",      noteSystem, notePrompt, 0.15),
      callModel(OR_KEY, "mistralai/mistral-7b-instruct:free",     noteSystem, notePrompt, 0.15),
      callModel(OR_KEY, "meta-llama/llama-3.1-8b-instruct:free", noteSystem, notePrompt, 0.15),
    ]);

    const pA = extractJSON(rA);
    const pB = extractJSON(rB);
    const pC = extractJSON(rC);
    console.log("[namarq-ai] Model responses extracted. pA keys:", Object.keys(pA).length);

    // ── STAGE 2: Semantic voting + confidence ─────────────────────────────────
    let voted      = semanticVote([pA, pB, pC], kbEntry, name);
    let profile    = voted.profile;
    let confidence = voted.confidence;
    let voteScore  = voted.score;
    const voteMax  = voted.max;

    // ── STAGE 3: Verification pass (fires if not already High) ───────────────
    if (confidence !== "High") {
      console.log("[namarq-ai] Confidence low/medium, running verification...");
      const verifySystem =
        "You are a senior perfume expert. Synthesize the most accurate JSON profile. " +
        "Return ONLY raw JSON.";

      const verifyPrompt =
        `Fragrance: "${name}"\n` +
        `A: ${JSON.stringify(pA)}\n` +
        `B: ${JSON.stringify(pB)}\n` +
        `C: ${JSON.stringify(pC)}\n` +
        (kbEntry ? `KB: ${JSON.stringify(kbEntry)}\n` : "") +
        SCHEMA_DESCRIPTION;

      const rV  = await callModel(OR_KEY, "google/gemini-2.0-flash-exp:free", verifySystem, verifyPrompt, 0.1);
      const pV  = extractJSON(rV);

      if (Object.keys(pV).length > 0) {
        const reVoted = semanticVote([pA, pB, pC, pV, pV], kbEntry, name);
        profile    = reVoted.profile;
        confidence = reVoted.confidence;
        voteScore  = reVoted.score;
      }
    }

    // ── STAGE 4: Luxury SEO generation ───────────────────────────────────────
    const finalName = profile.canonical_name || name;
    const house     = profile.house || (kbEntry ? kbEntry.house : "the house");
    const slug      = generateSlug(finalName);

    console.log("[namarq-ai] Generating SEO for:", finalName, "House:", house);

    const seoSystem =
      "You are a luxury perfume copywriter. Write poetic, high-end SEO content. " +
      "Return ONLY the requested sections with headers.";

    const seoPrompt = buildSEOPrompt(finalName, house, profile, slug);

    const rSEO    = await callModel(OR_KEY, "google/gemini-2.0-flash-exp:free", seoSystem, seoPrompt, 0.7);
    const seoText = extractText(rSEO) || buildFallbackSEO(finalName, house, profile, slug);

    // ── Response ──────────────────────────────────────────────────────────────
    const responseData = {
      name:       finalName,
      house,
      slug,
      confidence,
      voteScore,
      voteMax,
      kbVerified: kbEntry !== null,
      profile: {
        top:           profile.top           || "—",
        heart:         profile.heart         || "—",
        base:          profile.base          || "—",
        accords:       profile.accords       || "—",
        gender:        profile.gender        || "—",
        concentration: profile.concentration || "—",
        season:        profile.season        || "—",
        occasion:      profile.occasion      || "—",
        longevity:     profile.longevity     || "—",
        sillage:       profile.sillage       || "—",
        character:     profile.vibe          || "—",
      },
      seo: seoText,
    };

    console.log("[namarq-ai] Sending response. Profile top:", responseData.profile.top);
    return res.status(200).json(responseData);

  } catch (err) {
    console.error("[namarq-ai] Fatal error:", err);
    return res.status(500).json({ error: "Internal error. Please try again.", detail: err.message });
  }
}

// =============================================================================
// CORE UTILITIES
// =============================================================================

async function callModel(apiKey, model, system, user, temperature = 0.2) {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
        "HTTP-Referer":  "https://namarq.store",
        "X-Title":       "Namarq AI",
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: 1000,
        messages: [
          { role: "system", content: system },
          { role: "user",   content: user   },
        ],
      }),
    });
    if (!r.ok) { 
      const errText = await r.text();
      console.warn(`[model:${model}] HTTP ${r.status}: ${errText}`); 
      return null; 
    }
    return await r.json();
  } catch (e) {
    console.warn(`[model:${model}] failed:`, e.message);
    return null;
  }
}

function extractJSON(apiResponse) {
  const raw = apiResponse?.choices?.[0]?.message?.content;
  if (!raw || typeof raw !== "string") return {};
  const s = raw.trim();
  
  // Try direct parse
  try { return JSON.parse(s); } catch {}
  
  // Try markdown block
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch {} }
  
  // Try finding first { and last }
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    try { return JSON.parse(s.substring(firstBrace, lastBrace + 1)); } catch {}
  }
  
  return {};
}

function extractText(apiResponse) {
  const c = apiResponse?.choices?.[0]?.message?.content;
  return (c && typeof c === "string" && c.trim()) ? c.trim() : null;
}

// =============================================================================
// SEMANTIC VOTING ENGINE
// =============================================================================

function semanticVote(profiles, kbEntry, inputName) {
  const SCORED = ["top", "heart", "base", "gender", "concentration", "season", "occasion"];
  const ALL    = [...SCORED, "canonical_name", "house", "vibe", "longevity", "sillage", "accords"];

  const validProfiles = profiles.filter(p => Object.keys(p).length > 0);
  const n = validProfiles.length || 1;
  let totalScore = 0;
  const maxScore = SCORED.length * (validProfiles.length || 1);

  const merged = {};

  for (const field of ALL) {
    const values = validProfiles
      .map(p => normalize(field, p[field] || ""))
      .filter(Boolean);

    if (kbEntry && kbEntry[field]) {
      values.push(normalize(field, kbEntry[field]));
    }

    if (values.length === 0) { 
      merged[field] = (kbEntry && kbEntry[field]) ? kbEntry[field] : ""; 
      continue; 
    }

    const tally = {};
    for (const v of values) tally[v] = (tally[v] || 0) + 1;

    const [winValue, winVotes] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];

    if (SCORED.includes(field)) totalScore += winVotes;

    // Find original casing
    const original = [...validProfiles, kbEntry].filter(Boolean)
      .map(p => p[field])
      .find(v => v && normalize(field, v) === winValue);
      
    merged[field] = original || winValue;
  }

  const ratio = totalScore / maxScore;
  let confidence = "Low";
  if (ratio >= 0.75) confidence = "High";
  else if (ratio >= 0.45) confidence = "Medium";

  if (kbEntry) {
    for (const f of ["canonical_name", "house", "gender", "concentration"]) {
      if (kbEntry[f]) merged[f] = kbEntry[f];
    }
    if (confidence === "Low") confidence = "Medium";
  }

  if (!merged.canonical_name) merged.canonical_name = inputName;
  return { profile: merged, confidence, score: totalScore, max: maxScore };
}

function normalize(field, value) {
  if (!value) return "";
  let v = value.toString().toLowerCase().trim();

  if (["top", "heart", "base", "accords"].includes(field)) {
    return v.split(/,\s*/).map(s => s.trim()).filter(Boolean).sort().join(",");
  }
  if (field === "gender") {
    if (/\b(men|male|masculine|homme)\b/.test(v)) return "men";
    if (/\b(women|female|feminine|femme)\b/.test(v)) return "women";
    if (/\b(unisex|gender.?neutral|shared)\b/.test(v)) return "unisex";
    return v;
  }
  if (field === "concentration") {
    if (/\b(edp|eau de parfum)\b/.test(v)) return "edp";
    if (/\b(edt|eau de toilette)\b/.test(v)) return "edt";
    if (/\b(parfum|extrait|pure parfum)\b/.test(v) && !/toilette/.test(v)) return "parfum";
    if (/\b(edc|cologne|eau de cologne)\b/.test(v)) return "edc";
    return v;
  }
  return v;
}

// =============================================================================
// PROMPT BUILDERS
// =============================================================================

const SCHEMA_DESCRIPTION =
  `Return this exact JSON schema:\n` +
  `{\n` +
  `  "canonical_name": "string",\n` +
  `  "house": "string",\n` +
  `  "top": "string",\n` +
  `  "heart": "string",\n` +
  `  "base": "string",\n` +
  `  "accords": "string",\n` +
  `  "gender": "string",\n` +
  `  "concentration": "string",\n` +
  `  "season": "string",\n` +
  `  "occasion": "string",\n` +
  `  "vibe": "string",\n` +
  `  "longevity": "string",\n` +
  `  "sillage": "string"\n` +
  `}`;

function buildNotePrompt(name, kbEntry) {
  let hint = "";
  if (kbEntry) {
    hint = `\nReference: ${JSON.stringify(kbEntry)}\n`;
  }
  return `Retrieve olfactory profile for: "${name}"\n${hint}\n${SCHEMA_DESCRIPTION}`;
}

function buildSEOPrompt(name, house, profile, slug) {
  return (
    `Write luxury SEO content for: ${name} by ${house}\n` +
    `Data: ${JSON.stringify(profile)}\n\n` +
    `Sections:\n## Short Description\n## Meta Title\n## Meta Description\n## Product URL\n## SEO Tags`
  );
}

// =============================================================================
// NAME NORMALIZATION
// =============================================================================

function buildKey(name) {
  return name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function normalizePerfumeName(input) {
  const cleaned = input.trim();
  const key     = buildKey(cleaned);
  if (FRAGRANCE_KB[key]) return FRAGRANCE_KB[key].canonical_name;
  return cleaned;
}

function generateSlug(name) {
  return name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function buildFallbackSEO(name, house, profile, slug) {
  return [
    "## Short Description", "",
    `A fragrance by the house — opening with ${profile.top || "—"}, evolving through ${profile.heart || "—"}, and resting on a foundation of ${profile.base || "—"}.`,
    "", "## Meta Title", "",
    `${name} — | Namarq Egypt`,
    "", "## Meta Description", "",
    `Shop ${name} at Namarq. fragrance. Free delivery in Egypt on orders over 1500 EGP.`,
    "", "## Product URL", "", `/product/${slug}`,
    "", "## SEO Tags", "",
    `${name}, perfume Egypt, Namarq`,
  ].join("\n");
}

// =============================================================================
// FRAGRANCE KNOWLEDGE BASE
// =============================================================================

const FRAGRANCE_KB = {
  "creed aventus": {
    canonical_name: "Creed Aventus", house: "Creed",
    top: "Pineapple, Bergamot, Black Currant, Apple",
    heart: "Birch, Patchouli, Rose, Jasmine",
    base: "Musk, Oakmoss, Ambergris, Vanilla", accords: "Fruity Chypre, Woody, Smoky",
    gender: "Men", concentration: "EDP", season: "Spring, Summer, Autumn",
    occasion: "Special Occasion, Evening", vibe: "confident, victorious, powerful, distinguished, smoky",
    longevity: "Good", sillage: "Strong",
  },
  "creed": {
    canonical_name: "Creed Aventus", house: "Creed",
    top: "Pineapple, Bergamot, Black Currant, Apple",
    heart: "Birch, Patchouli, Rose, Jasmine",
    base: "Musk, Oakmoss, Ambergris, Vanilla", accords: "Fruity Chypre, Woody, Smoky",
    gender: "Men", concentration: "EDP", season: "Spring, Summer, Autumn",
    occasion: "Special Occasion, Evening", vibe: "confident, victorious, powerful, distinguished, smoky",
    longevity: "Good", sillage: "Strong",
  }
};
