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
    // ── STAGE 0: Normalize + KB seed ─────────────────────────────────────────
    const name    = normalizePerfumeName(rawName);
    const kbEntry = FRAGRANCE_KB[buildKey(name)] || null;

    // ── STAGE 1: Triple-model parallel extraction ─────────────────────────────
    const noteSystem =
      "You are an expert perfume database with encyclopedic knowledge of every " +
      "commercial fragrance ever made. Return ONLY a raw JSON object — no markdown, " +
      "no backticks, no prose before or after. Be precise and factual. " +
      "If uncertain about a specific ingredient, name the accord family " +
      "(e.g. 'woody amber') rather than inventing a note that is not real.";

    const notePrompt = buildNotePrompt(name, kbEntry);

    const [rA, rB, rC] = await Promise.all([
      callModel(OR_KEY, "google/gemini-2.0-flash-exp:free",      noteSystem, notePrompt, 0.15),
      callModel(OR_KEY, "mistralai/mistral-7b-instruct:free",     noteSystem, notePrompt, 0.15),
      callModel(OR_KEY, "meta-llama/llama-3.1-8b-instruct:free", noteSystem, notePrompt, 0.15),
    ]);

    const pA = extractJSON(rA);
    const pB = extractJSON(rB);
    const pC = extractJSON(rC);

    // ── STAGE 2: Semantic voting + confidence ─────────────────────────────────
    let voted      = semanticVote([pA, pB, pC], kbEntry, name);
    let profile    = voted.profile;
    let confidence = voted.confidence;
    let voteScore  = voted.score;
    const voteMax  = voted.max;

    // ── STAGE 3: Verification pass (fires if not already High) ───────────────
    if (confidence !== "High") {
      const verifySystem =
        "You are a senior perfume expert and fact-checker. Three AI models have each " +
        "produced a structured fragrance profile. Your job is to synthesize the single " +
        "most accurate answer. Prefer the majority value for each field. Where models " +
        "disagree, apply your expert knowledge to pick the correct value. " +
        "Return ONLY a raw JSON object — no markdown, no backticks, no prose.";

      const verifyPrompt =
        `Fragrance being evaluated: "${name}"\n\n` +
        `Model A response:\n${JSON.stringify(pA, null, 2)}\n\n` +
        `Model B response:\n${JSON.stringify(pB, null, 2)}\n\n` +
        `Model C response:\n${JSON.stringify(pC, null, 2)}\n\n` +
        (kbEntry ? `Verified ground-truth reference:\n${JSON.stringify(kbEntry, null, 2)}\n\n` : "") +
        `Synthesize the most accurate JSON profile for this fragrance.\n` +
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
    const house     = profile.house || "";
    const slug      = generateSlug(finalName);

    const seoSystem =
      "You are the creative director and head copywriter of Namarq, a luxury " +
      "Arabian perfume house based in Mansoura, Egypt. Your prose has the depth " +
      "of Hermès, the seduction of Tom Ford, and the poetic precision of " +
      "Maison Francis Kurkdjian. You create desire with language — every sentence " +
      "makes the reader feel something. You never use hollow clichés like " +
      "'perfect for any occasion' or 'designed for the modern man'. Your grammar " +
      "is impeccable: 'An' before vowel sounds. Return ONLY the requested sections.";

    const seoPrompt = buildSEOPrompt(finalName, house, profile, slug);

    const rSEO    = await callModel(OR_KEY, "google/gemini-2.0-flash-exp:free", seoSystem, seoPrompt, 0.7);
    const seoText = extractText(rSEO) || buildFallbackSEO(finalName, house, profile, slug);

    // ── Response ──────────────────────────────────────────────────────────────
    return res.status(200).json({
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
    });

  } catch (err) {
    console.error("[namarq-ai]", err);
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
        max_tokens: 900,
        messages: [
          { role: "system", content: system },
          { role: "user",   content: user   },
        ],
      }),
    });
    if (!r.ok) { console.warn(`[model:${model}] HTTP ${r.status}`); return null; }
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
  try { return JSON.parse(s); } catch {}
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch {} }
  const braced = s.match(/\{[\s\S]*\}/);
  if (braced) { try { return JSON.parse(braced[0]); } catch {} }
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

  const n = profiles.length;
  let totalScore = 0;
  const maxScore = SCORED.length * n;

  const merged = {};

  for (const field of ALL) {
    const values = profiles
      .map(p => normalize(field, p[field] || ""))
      .filter(Boolean);

    if (kbEntry && kbEntry[field]) {
      values.push(normalize(field, kbEntry[field]));
    }

    if (values.length === 0) { merged[field] = ""; continue; }

    const tally = {};
    for (const v of values) tally[v] = (tally[v] || 0) + 1;

    const [winValue, winVotes] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];

    if (SCORED.includes(field)) totalScore += winVotes;

    merged[field] = profiles
      .map(p => p[field])
      .find(v => v && normalize(field, v) === winValue) || winValue;
  }

  const ratio = totalScore / maxScore;
  let confidence = "Low";
  if (ratio >= 0.78) confidence = "High";
  else if (ratio >= 0.48) confidence = "Medium";

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
  `Return this exact JSON schema (no other text):\n` +
  `{\n` +
  `  "canonical_name": "Exact full name as known in perfumery",\n` +
  `  "house": "Perfume brand / house",\n` +
  `  "top": "Top notes — comma-separated",\n` +
  `  "heart": "Heart/middle notes — comma-separated",\n` +
  `  "base": "Base notes — comma-separated",\n` +
  `  "accords": "Main accords — comma-separated",\n` +
  `  "gender": "Men | Women | Unisex",\n` +
  `  "concentration": "EDT | EDP | Parfum | EDC | other",\n` +
  `  "season": "Best season(s)",\n` +
  `  "occasion": "Best occasion(s)",\n` +
  `  "vibe": "3-5 evocative adjectives",\n` +
  `  "longevity": "Poor | Moderate | Good | Excellent",\n` +
  `  "sillage": "Intimate | Moderate | Strong | Beast Mode"\n` +
  `}`;

function buildNotePrompt(name, kbEntry) {
  let hint = "";
  if (kbEntry) {
    hint = `\nVerified reference data (use as anchor):\n${JSON.stringify(kbEntry, null, 2)}\n\n`;
  }
  return (
    `Retrieve the complete olfactory profile for the fragrance: "${name}"\n` +
    hint +
    `Use only notes that are actually part of this fragrance. Be accurate.\n` +
    SCHEMA_DESCRIPTION
  );
}

function buildSEOPrompt(name, house, profile, slug) {
  return (
    `Write luxury SEO content for this Namarq product listing.\n\n` +
    `FRAGRANCE DATA:\n` +
    `Name: ${name}\nHouse: ${house}\n` +
    `Gender: ${profile.gender} · Concentration: ${profile.concentration}\n` +
    `Top: ${profile.top}\nHeart: ${profile.heart}\nBase: ${profile.base}\n` +
    `Accords: ${profile.accords}\nSeason: ${profile.season}\n` +
    `Occasion: ${profile.occasion}\nCharacter: ${profile.vibe}\n` +
    `Longevity: ${profile.longevity} · Sillage: ${profile.sillage}\n\n` +
    `OUTPUT — use these exact section headers, nothing else:\n\n` +
    `## Short Description\n` +
    `[130-180 words. Open with a sensory hook — invoke the mood or moment ` +
    `this fragrance belongs to. Weave notes into narrative, never list them. ` +
    `Close with a line that creates desire. Correct grammar: "An" before vowel sounds.]\n\n` +
    `## Meta Title\n` +
    `[Max 60 chars. Format: {Name} — {House} | Namarq Egypt]\n\n` +
    `## Meta Description\n` +
    `[Max 155 chars. Include fragrance name, one sensory detail, ` +
    `"Free delivery in Egypt on orders over 1500 EGP".]\n\n` +
    `## Product URL\n` +
    `/product/${slug}\n\n` +
    `## SEO Tags\n` +
    `[10-14 comma-separated: name, house, gender, notes, season, occasion, ` +
    `"perfume Egypt", "Namarq", Arabic market keywords]`
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

  const ALIASES = {
    "sauvage": "Dior Sauvage", "dior sauvage": "Dior Sauvage",
    "suvage": "Dior Sauvage", "svage": "Dior Sauvage",
    "savuge": "Dior Sauvage", "sauvege": "Dior Sauvage",
    "sauvage elixir": "Dior Sauvage Elixir", "dior sauvage elixir": "Dior Sauvage Elixir",
    "dior elixir": "Dior Sauvage Elixir",
    "j adore": "Dior J'adore", "jadore": "Dior J'adore", "dior jadore": "Dior J'adore",
    "miss dior": "Miss Dior", "fahrenheit": "Dior Fahrenheit",
    "dior homme intense": "Dior Homme Intense", "homme intense": "Dior Homme Intense",
    "oud ispahan": "Dior Oud Ispahan",
    "bleu de chanel": "Bleu de Chanel", "bleu chanel": "Bleu de Chanel",
    "blue chanel": "Bleu de Chanel", "chanel no 5": "Chanel No. 5",
    "chanel no5": "Chanel No. 5", "no 5": "Chanel No. 5",
    "coco mademoiselle": "Chanel Coco Mademoiselle",
    "chance": "Chanel Chance", "chanel chance": "Chanel Chance",
    "allure homme sport": "Chanel Allure Homme Sport",
    "egoiste": "Chanel Égoïste",
    "oud wood": "Tom Ford Oud Wood", "black orchid": "Tom Ford Black Orchid",
    "tobacco vanille": "Tom Ford Tobacco Vanille", "lost cherry": "Tom Ford Lost Cherry",
    "noir extreme": "Tom Ford Noir Extrême", "neroli portofino": "Tom Ford Neroli Portofino",
    "soleil blanc": "Tom Ford Soleil Blanc", "rose prick": "Tom Ford Rose Prick",
    "la nuit de lhomme": "YSL La Nuit de L'Homme",
    "la nuit de l homme": "YSL La Nuit de L'Homme", "ysl la nuit": "YSL La Nuit de L'Homme",
    "libre": "YSL Libre", "ysl libre": "YSL Libre",
    "black opium": "YSL Black Opium", "ysl black opium": "YSL Black Opium",
    "mon paris": "YSL Mon Paris", "y ysl": "YSL Y", "ysl y": "YSL Y",
    "aventus": "Creed Aventus", "creed aventus": "Creed Aventus",
    "green irish tweed": "Creed Green Irish Tweed",
    "silver mountain water": "Creed Silver Mountain Water",
    "viking": "Creed Viking", "millesime imperial": "Creed Millésime Impérial",
    "acqua di gio": "Armani Acqua di Giò",
    "acqua di gio profondo": "Armani Acqua di Giò Profondo",
    "si": "Armani Sì", "armani si": "Armani Sì", "armani code": "Armani Code",
    "eros": "Versace Eros", "versace eros": "Versace Eros",
    "dylan blue": "Versace Dylan Blue", "bright crystal": "Versace Bright Crystal",
    "1 million": "Paco Rabanne 1 Million", "one million": "Paco Rabanne 1 Million",
    "invictus": "Paco Rabanne Invictus", "olympea": "Paco Rabanne Olympéa",
    "light blue": "Dolce & Gabbana Light Blue", "the one": "Dolce & Gabbana The One",
    "la vie est belle": "Lancôme La Vie Est Belle", "idole": "Lancôme Idôle",
    "beach walk": "Maison Margiela Replica Beach Walk",
    "by the fireplace": "Maison Margiela Replica By the Fireplace",
    "jazz club": "Maison Margiela Replica Jazz Club",
    "terre dhermes": "Hermès Terre d'Hermès", "terre hermes": "Hermès Terre d'Hermès",
    "twilly": "Hermès Twilly d'Hermès",
    "baccarat rouge 540": "Baccarat Rouge 540",
    "baccarat rouge": "Baccarat Rouge 540", "br540": "Baccarat Rouge 540",
    "man in black": "Bvlgari Man in Black", "polo blue": "Ralph Lauren Polo Blue",
    "black aoud": "Montale Black Aoud", "intense cafe": "Montale Intense Café",
    "roses musk": "Montale Roses Musk",
  };

  if (ALIASES[key]) return ALIASES[key];

  const SMALL = new Set(["de", "di", "la", "le", "les", "du", "by", "for", "of", "and", "en", "et", "sur"]);
  return cleaned.toLowerCase().split(/\s+/).map((w, i) =>
    i === 0 || !SMALL.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w
  ).join(" ");
}

// =============================================================================
// SLUG + FALLBACK SEO
// =============================================================================

function generateSlug(name) {
  return name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function buildFallbackSEO(name, house, profile, slug) {
  const art = /^[aeiou]/i.test(profile.gender || "") ? "An" : "A";
  return [
    "## Short Description", "",
    `${art} ${(profile.gender || "").toLowerCase()} fragrance by the house — opening with ${profile.top || "—"}, evolving through ${profile.heart || "—"}, and resting on a foundation of ${profile.base || "—"}.`,
    "", "## Meta Title", "",
    `${house || "Creed"} — | Namarq Egypt`,
    "", "## Meta Description", "",
    `Shop ${house || "Creed"} at Namarq. fragrance. Free delivery in Egypt on orders over 1500 EGP.`,
    "", "## Product URL", "", `/product/${slug}`,
    "", "## SEO Tags", "",
    `${house || "Creed"}, perfume Egypt, Namarq`,
  ].join("\n");
}

// =============================================================================
// FRAGRANCE KNOWLEDGE BASE — ground-truth seeds
// =============================================================================

const FRAGRANCE_KB = {
  "dior sauvage": {
    canonical_name: "Dior Sauvage", house: "Christian Dior",
    top: "Bergamot, Pepper", heart: "Sichuan Pepper, Lavender, Pink Pepper, Vetiver, Patchouli, Geranium, Elemi",
    base: "Ambroxan, Cedar, Labdanum", accords: "Fresh Spicy, Woody, Aromatic",
    gender: "Men", concentration: "EDT", season: "Spring, Summer, Autumn",
    occasion: "Casual, Office", vibe: "raw, magnetic, fresh, masculine, rugged",
    longevity: "Good", sillage: "Strong",
  },
  "dior sauvage elixir": {
    canonical_name: "Dior Sauvage Elixir", house: "Christian Dior",
    top: "Grapefruit, Cinnamon, Cardamom", heart: "Lavender, Licorice, Nutmeg",
    base: "Sandalwood, Haitian Vetiver, Hawthorn", accords: "Woody Spicy, Aromatic, Warm",
    gender: "Men", concentration: "Parfum", season: "Autumn, Winter",
    occasion: "Evening, Special Occasion", vibe: "dark, opulent, intense, sophisticated, smoldering",
    longevity: "Excellent", sillage: "Beast Mode",
  },
  "bleu de chanel": {
    canonical_name: "Bleu de Chanel", house: "Chanel",
    top: "Grapefruit, Lemon, Mint, Pink Pepper",
    heart: "Ginger, Nutmeg, Jasmine, ISO E Super",
    base: "Sandalwood, Patchouli, Vetiver, Cedar, Labdanum, White Musk",
    accords: "Aromatic Fougère, Woody, Fresh",
    gender: "Men", concentration: "EDP", season: "All Seasons",
    occasion: "Office, Casual, Evening", vibe: "polished, versatile, clean, confident, timeless",
    longevity: "Good", sillage: "Moderate",
  },
  "creed aventus": {
    canonical_name: "Creed Aventus", house: "Creed",
    top: "Pineapple, Bergamot, Black Currant, Apple",
    heart: "Birch, Patchouli, Rose, Jasmine",
    base: "Musk, Oakmoss, Ambergris, Vanilla", accords: "Fruity Chypre, Woody, Smoky",
    gender: "Men", concentration: "EDP", season: "Spring, Summer, Autumn",
    occasion: "Special Occasion, Evening", vibe: "confident, victorious, powerful, distinguished, smoky",
    longevity: "Good", sillage: "Strong",
  },
  "baccarat rouge 540": {
    canonical_name: "Baccarat Rouge 540", house: "Maison Francis Kurkdjian",
    top: "Jasmine, Saffron", heart: "Amberwood, Ambergris",
    base: "Fir Resin, Cedar", accords: "Amber Woody, Floral, Sweet",
    gender: "Unisex", concentration: "EDP", season: "Autumn, Winter",
    occasion: "Evening, Special Occasion", vibe: "ethereal, ambery, luminous, addictive, distinctive",
    longevity: "Excellent", sillage: "Strong",
  },
  "tom ford black orchid": {
    canonical_name: "Tom Ford Black Orchid", house: "Tom Ford",
    top: "Truffle, Gardenia, Black Currant, Ylang-Ylang, Jasmine, Bergamot",
    heart: "Black Orchid, Lotus, Fruit, Vetiver, Spices",
    base: "Dark Chocolate, Incense, Patchouli, Vanilla, Sandalwood, Amber, Balsam",
    accords: "Dark Floral, Chypre, Oriental",
    gender: "Unisex", concentration: "EDP", season: "Autumn, Winter",
    occasion: "Evening, Special Occasion", vibe: "dark, opulent, sensual, mysterious, iconic",
    longevity: "Excellent", sillage: "Strong",
  },
  "tom ford oud wood": {
    canonical_name: "Tom Ford Oud Wood", house: "Tom Ford",
    top: "Rosewood, Cardamom, Chinese Pepper", heart: "Oud, Sandalwood, Vetiver",
    base: "Tonka Bean, Amber, Vanilla", accords: "Oud Woody, Spicy, Warm",
    gender: "Unisex", concentration: "EDP", season: "Autumn, Winter",
    occasion: "Evening, Office", vibe: "rare, smoky, refined, woody, confident",
    longevity: "Excellent", sillage: "Moderate",
  },
  "ysl black opium": {
    canonical_name: "YSL Black Opium", house: "Yves Saint Laurent",
    top: "Pink Pepper, Orange Blossom, Pear", heart: "Coffee, Jasmine, Bitter Almond",
    base: "White Musk, Vanilla, Patchouli, Cedar", accords: "Sweet, Gourmand, Floral",
    gender: "Women", concentration: "EDP", season: "Autumn, Winter",
    occasion: "Evening, Casual", vibe: "bold, addictive, sensual, edgy, feminine",
    longevity: "Good", sillage: "Moderate",
  },
  "versace eros": {
    canonical_name: "Versace Eros", house: "Versace",
    top: "Mint, Lemon, Green Apple", heart: "Tonka Bean, Ambroxan, Geranium",
    base: "Vanilla, Vetiver, Oakmoss, Cedar, Atlas Cedar", accords: "Fresh Aromatic, Woody, Sweet",
    gender: "Men", concentration: "EDT", season: "Spring, Summer",
    occasion: "Casual, Evening", vibe: "youthful, fresh, bold, sensual, Mediterranean",
    longevity: "Good", sillage: "Strong",
  },
  "paco rabanne 1 million": {
    canonical_name: "Paco Rabanne 1 Million", house: "Paco Rabanne",
    top: "Blood Mandarin, Grapefruit, Mint", heart: "Rose, Cinnamon, Spices",
    base: "Leather, Amber, Patchouli, White Wood, Blond Wood", accords: "Spicy Leather, Sweet, Aromatic",
    gender: "Men", concentration: "EDT", season: "Autumn, Winter",
    occasion: "Evening, Special Occasion", vibe: "seductive, loud, opulent, confident, crowd-pleasing",
    longevity: "Good", sillage: "Strong",
  },
  "paco rabanne invictus": {
    canonical_name: "Paco Rabanne Invictus", house: "Paco Rabanne",
    top: "Grapefruit, Marine Accord, Bay Leaf", heart: "Jasmine, Hedione, Guaiac Wood",
    base: "Oakmoss, Ambergris, Indonesian Patchouli", accords: "Fresh Fougère, Woody, Aquatic",
    gender: "Men", concentration: "EDT", season: "Spring, Summer",
    occasion: "Sport, Casual", vibe: "victorious, energetic, fresh, athletic, magnetic",
    longevity: "Good", sillage: "Strong",
  },
  "armani acqua di gio": {
    canonical_name: "Armani Acqua di Giò", house: "Giorgio Armani",
    top: "Green Accord, Bergamot, Neroli, Lemon, Green Tangerine",
    heart: "Rosemary, Jasmine, Marine Notes, Peach",
    base: "White Musk, Cedar, Oakmoss, Amber, Patchouli", accords: "Aquatic, Aromatic, Woody",
    gender: "Men", concentration: "EDT", season: "Spring, Summer",
    occasion: "Casual, Sport", vibe: "fresh, Mediterranean, clean, effortless, timeless",
    longevity: "Moderate", sillage: "Moderate",
  },
  "lancome la vie est belle": {
    canonical_name: "Lancôme La Vie Est Belle", house: "Lancôme",
    top: "Black Currant, Pear", heart: "Iris, Jasmine, Orange Blossom",
    base: "Praline, Vanilla, Patchouli, Sandalwood", accords: "Gourmand, Floral, Iris",
    gender: "Women", concentration: "EDP", season: "Autumn, Winter",
    occasion: "Evening, Special Occasion", vibe: "joyful, sweet, feminine, radiant, warm",
    longevity: "Good", sillage: "Moderate",
  },
  "miss dior": {
    canonical_name: "Miss Dior", house: "Christian Dior",
    top: "Pink Pepper, Aldehydes", heart: "Peony, Rose Absolute, Lily of the Valley",
    base: "Patchouli, Sandalwood, Musk", accords: "Floral Chypre, Powdery, Fresh",
    gender: "Women", concentration: "EDP", season: "Spring, Summer",
    occasion: "Casual, Office", vibe: "romantic, feminine, fresh, timeless, Parisian",
    longevity: "Good", sillage: "Moderate",
  },
  "chanel no 5": {
    canonical_name: "Chanel No. 5", house: "Chanel",
    top: "Aldehydes, Bergamot, Lemon, Neroli", heart: "Iris, Jasmine, Rose, Lily of the Valley",
    base: "Civet, Oakmoss, Sandalwood, Vetiver, Vanilla", accords: "Powdery Floral, Aldehyde, Classic",
    gender: "Women", concentration: "EDP", season: "All Seasons",
    occasion: "Evening, Special Occasion", vibe: "iconic, timeless, feminine, radiant, classic",
    longevity: "Excellent", sillage: "Strong",
  },
};
