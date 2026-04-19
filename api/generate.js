// =============================================================================
// Namarq AI – Perfume SEO Generator
// api/generate.js  (Vercel Serverless Function)
// =============================================================================
// Architecture:
//   Step 0 – Normalize / canonicalize the perfume name
//   Step 1 – Parallel dual-model note extraction  (Promise.all)
//   Step 2 – JSON extraction with fence-stripping + smart merge + confidence
//   Step 3 – Luxury SEO copy generation (Gemini, system prompt)
//   Step 4 – Structured JSON response
// =============================================================================

export default async function handler(req, res) {

  // ── Method guard ────────────────────────────────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // ── Input validation ────────────────────────────────────────────────────────
  const rawName = (req.body?.name || "").toString().trim();
  if (!rawName) {
    return res.status(400).json({ error: "Perfume name is required." });
  }

  const OR_KEY = process.env.OPENROUTER_API_KEY;
  if (!OR_KEY) {
    return res.status(500).json({ error: "Server configuration error: missing API key." });
  }

  try {

    // ── STEP 0 ─ Name normalization ───────────────────────────────────────────
    // Fix common user errors: all-caps, lowercase, missing spaces, misspellings.
    // The normalizer uses a small canonical lookup table for top bestsellers,
    // then falls back to title-casing for unknown names.
    const name = normalizePerfumeName(rawName);


    // ── STEP 1 ─ Parallel dual-model note extraction ──────────────────────────
    // Both requests fire simultaneously to minimize latency.
    // We use a strong system prompt to maximize format compliance.

    const noteSystemPrompt =
      "You are an expert perfumery database. You have encyclopedic knowledge of " +
      "every commercial fragrance ever released. You return ONLY raw JSON — no " +
      "markdown, no backticks, no explanation, no preamble. Your data must be " +
      "accurate to the actual fragrance, never invented. If you are uncertain about " +
      "a specific note, describe the accord family instead of guessing an exact ingredient.";

    const noteUserPrompt =
      `Retrieve the olfactory profile for the fragrance: "${name}".\n\n` +
      `Return ONLY this exact JSON structure, no other text:\n` +
      `{\n` +
      `  "canonical_name": "The correct, properly spelled full name of this fragrance",\n` +
      `  "house": "The perfume house / brand",\n` +
      `  "top": "Comma-separated top notes (what you smell first, 0–30 min)",\n` +
      `  "heart": "Comma-separated heart/middle notes (the core, 30 min–3 hr)",\n` +
      `  "base": "Comma-separated base notes (the dry-down, 3+ hr)",\n` +
      `  "gender": "Men | Women | Unisex",\n` +
      `  "concentration": "EDT | EDP | Parfum | Cologne | other",\n` +
      `  "season": "Best season(s): Spring / Summer / Autumn / Winter",\n` +
      `  "occasion": "Best occasion: Casual / Office / Evening / Sport / Special Occasion",\n` +
      `  "vibe": "3-5 evocative adjectives describing this fragrance's character",\n` +
      `  "longevity": "Poor | Moderate | Good | Excellent",\n` +
      `  "sillage": "Intimate | Moderate | Strong | Beast Mode"\n` +
      `}`;

    const [responseA, responseB] = await Promise.all([
      callModel(OR_KEY, "google/gemini-2.0-flash-exp:free", noteSystemPrompt, noteUserPrompt),
      callModel(OR_KEY, "mistralai/mistral-7b-instruct:free",  noteSystemPrompt, noteUserPrompt),
    ]);


    // ── STEP 2 ─ Parse + merge + confidence ───────────────────────────────────
    const dataA = extractJSON(responseA);
    const dataB = extractJSON(responseB);

    const merged  = mergeWithConfidence(dataA, dataB, name);
    const profile = merged.profile;
    const confidence = merged.confidence; // "High" | "Medium" | "Low"

    // Use canonical name if the AI returned a corrected spelling
    const finalName = profile.canonical_name || name;
    const house      = profile.house || "";

    const slug = generateSlug(finalName);


    // ── STEP 3 ─ Luxury SEO copy generation ───────────────────────────────────
    // The SEO model receives structured data and a tight system prompt.
    // It generates: product description, meta title, meta description.

    const seoSystemPrompt =
      "You are the head copywriter at a luxury Arabian perfume house. " +
      "Your writing has the refinement of Dior, the sensuality of Tom Ford, " +
      "and the storytelling of Maison Margiela. Every sentence must feel " +
      "intentional, evocative, and premium. You never use generic marketing phrases " +
      "like 'perfect for any occasion' or 'designed for the modern man/woman'. " +
      "You write in flawless English with correct grammar (use 'An' before vowel sounds). " +
      "You return ONLY the exact sections asked for — no extra commentary.";

    const seoUserPrompt =
      `Write luxury SEO content for this fragrance listing on Namarq Perfumes (Egypt).\n\n` +
      `FRAGRANCE DATA:\n` +
      `- Name: ${finalName}\n` +
      `- House: ${house}\n` +
      `- Gender: ${profile.gender}\n` +
      `- Concentration: ${profile.concentration}\n` +
      `- Top Notes: ${profile.top}\n` +
      `- Heart Notes: ${profile.heart}\n` +
      `- Base Notes: ${profile.base}\n` +
      `- Season: ${profile.season}\n` +
      `- Occasion: ${profile.occasion}\n` +
      `- Character: ${profile.vibe}\n` +
      `- Longevity: ${profile.longevity}\n` +
      `- Sillage: ${profile.sillage}\n\n` +
      `OUTPUT FORMAT (use these exact section headers, nothing else):\n\n` +
      `## Short Description\n` +
      `[Write 2–3 sentences, 120–180 words. Open with a sensory hook — invoke the mood ` +
      `or moment this fragrance belongs to. Weave the notes in naturally, never list them. ` +
      `Close with a line that makes the reader want to own it.]\n\n` +
      `## Meta Title\n` +
      `[Max 60 characters. Format: {Name} {Concentration} – {House} | Namarq Egypt]\n\n` +
      `## Meta Description\n` +
      `[Max 155 characters. Must include the fragrance name, a sensory detail, and ` +
      `"Free delivery in Egypt on orders over 1500 EGP". Natural, not robotic.]\n\n` +
      `## Product URL\n` +
      `/product/${slug}\n\n` +
      `## Tags\n` +
      `[8–12 comma-separated SEO tags: include name, house, gender, notes, season, occasion]`;

    const seoResponse = await callModel(
      OR_KEY,
      "google/gemini-2.0-flash-exp:free",
      seoSystemPrompt,
      seoUserPrompt
    );

    const seoOutput = extractText(seoResponse);


    // ── STEP 4 ─ Build structured response ────────────────────────────────────
    // Return both the raw profile data AND the formatted SEO copy.
    // The frontend renders both sections independently.

    return res.status(200).json({
      name: finalName,
      house,
      slug,
      confidence,
      profile: {
        top:           profile.top          || "—",
        heart:         profile.heart        || "—",
        base:          profile.base         || "—",
        gender:        profile.gender       || "—",
        concentration: profile.concentration|| "—",
        season:        profile.season       || "—",
        occasion:      profile.occasion     || "—",
        vibe:          profile.vibe         || "—",
        longevity:     profile.longevity    || "—",
        sillage:       profile.sillage      || "—",
      },
      seo: seoOutput || buildFallbackSEO(finalName, house, profile, slug),
    });

  } catch (err) {
    console.error("[namarq-ai] Fatal error:", err);
    return res.status(500).json({
      error: "Internal server error. Please try again.",
      detail: err.message,
    });
  }
}


// =============================================================================
// UTILITIES
// =============================================================================

/**
 * callModel — POST to OpenRouter with system + user message pair.
 * Returns the raw parsed JSON response body, or null on failure.
 */
async function callModel(apiKey, model, systemPrompt, userPrompt) {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://namarq.store",
        "X-Title": "Namarq AI SEO Generator",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,         // Low temperature = more factual, less hallucination
        max_tokens: 1200,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(`[namarq-ai] Model ${model} returned HTTP ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.warn(`[namarq-ai] Model ${model} failed:`, err.message);
    return null;
  }
}


/**
 * extractJSON — Safely pull a JSON object out of a model response.
 * Handles: raw JSON, ```json fences, partial text before/after JSON.
 */
function extractJSON(apiResponse) {
  const raw = apiResponse?.choices?.[0]?.message?.content;
  if (!raw || typeof raw !== "string") return {};

  // 1. Try raw parse first (ideal case)
  try { return JSON.parse(raw.trim()); } catch {}

  // 2. Strip markdown fences: ```json ... ``` or ``` ... ```
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  // 3. Extract first {...} block from the string
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch {}
  }

  return {};
}


/**
 * extractText — Pull the text content from a model response.
 */
function extractText(apiResponse) {
  const content = apiResponse?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") return null;
  return content.trim() || null;
}


/**
 * mergeWithConfidence — Compare two model outputs field by field.
 * Agreement = higher confidence. Smart fallback when both diverge.
 *
 * Confidence tiers:
 *   High   — 7+ agreement points (models agree on most fields)
 *   Medium — 4–6 agreement points
 *   Low    — 0–3 agreement points (treat output with caution)
 */
function mergeWithConfidence(a, b, inputName) {

  // Fields to compare for confidence scoring
  const scoredFields = ["top", "heart", "base", "gender", "concentration", "season"];

  let score = 0;

  function pickField(field, fallback = "—") {
    const va = (a[field] || "").trim();
    const vb = (b[field] || "").trim();

    if (va && vb) {
      // Normalize to lowercase for comparison (ignore case differences)
      if (va.toLowerCase() === vb.toLowerCase()) {
        if (scoredFields.includes(field)) score += 2; // Full agreement
        return va; // Prefer model A's casing
      } else {
        if (scoredFields.includes(field)) score += 1; // Partial agreement
        // Prefer the longer, more detailed response
        return va.length >= vb.length ? va : vb;
      }
    }

    if (va) { if (scoredFields.includes(field)) score += 1; return va; }
    if (vb) { if (scoredFields.includes(field)) score += 1; return vb; }
    return fallback;
  }

  const profile = {
    canonical_name: pickField("canonical_name") || inputName,
    house:          pickField("house"),
    top:            pickField("top",           "citrus, bergamot"),
    heart:          pickField("heart",         "aromatic, spicy"),
    base:           pickField("base",          "woody, musk, amber"),
    gender:         pickField("gender",        "Unisex"),
    concentration:  pickField("concentration", "EDP"),
    season:         pickField("season",        "All seasons"),
    occasion:       pickField("occasion",      "Versatile"),
    vibe:           pickField("vibe",          "refined, elegant"),
    longevity:      pickField("longevity",     "Moderate"),
    sillage:        pickField("sillage",       "Moderate"),
  };

  // Max possible score = scoredFields.length × 2 = 12
  const maxScore = scoredFields.length * 2;
  let confidence = "Low";
  if (score >= Math.floor(maxScore * 0.75)) confidence = "High";
  else if (score >= Math.floor(maxScore * 0.4)) confidence = "Medium";

  return { profile, confidence, score, maxScore };
}


/**
 * normalizePerfumeName — Correct common user input errors.
 *
 * Strategy:
 *   1. Check canonical lookup table (covers top-selling fragrances)
 *   2. If not found, apply title-case normalization
 *
 * The lookup is intentionally limited to avoid false matches.
 * Unknown fragrances get clean title-casing and pass through to the AI.
 */
function normalizePerfumeName(input) {
  const cleaned = input.trim();

  // Build a normalized key for lookup (lowercase, collapse spaces)
  const key = cleaned.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "");

  // ── Canonical perfume name table ──────────────────────────────────────────
  // Covers common misspellings, all-caps variants, missing house names.
  // Format: "lookup key": "Canonical Name"
  const CANONICAL = {
    // Dior
    "sauvage": "Dior Sauvage",
    "dior sauvage": "Dior Sauvage",
    "suvage": "Dior Sauvage",
    "svage": "Dior Sauvage",
    "savuge": "Dior Sauvage",
    "sauvage elixir": "Dior Sauvage Elixir",
    "dior sauvage elixir": "Dior Sauvage Elixir",
    "miss dior": "Miss Dior",
    "j adore": "Dior J'adore",
    "jadore": "Dior J'adore",
    "dior jadore": "Dior J'adore",
    "dior homme": "Dior Homme",

    // Chanel
    "bleu de chanel": "Bleu de Chanel",
    "bleu chanel": "Bleu de Chanel",
    "blue chanel": "Bleu de Chanel",
    "chanel no 5": "Chanel No. 5",
    "chanel no5": "Chanel No. 5",
    "no 5": "Chanel No. 5",
    "coco mademoiselle": "Chanel Coco Mademoiselle",
    "chanel coco mademoiselle": "Chanel Coco Mademoiselle",
    "chance chanel": "Chanel Chance",
    "chanel chance": "Chanel Chance",
    "allure homme sport": "Chanel Allure Homme Sport",

    // Tom Ford
    "oud wood": "Tom Ford Oud Wood",
    "tom ford oud wood": "Tom Ford Oud Wood",
    "black orchid": "Tom Ford Black Orchid",
    "tom ford black orchid": "Tom Ford Black Orchid",
    "tobacco vanille": "Tom Ford Tobacco Vanille",
    "lost cherry": "Tom Ford Lost Cherry",
    "fucking fabulous": "Tom Ford Fucking Fabulous",
    "noir extreme": "Tom Ford Noir Extreme",
    "tom ford noir extreme": "Tom Ford Noir Extreme",
    "neroli portofino": "Tom Ford Neroli Portofino",
    "soleil blanc": "Tom Ford Soleil Blanc",
    "rose prick": "Tom Ford Rose Prick",

    // Yves Saint Laurent
    "la nuit de lhomme": "YSL La Nuit de L'Homme",
    "la nuit de l homme": "YSL La Nuit de L'Homme",
    "ysl la nuit": "YSL La Nuit de L'Homme",
    "y ysl": "YSL Y",
    "ysl y": "YSL Y",
    "libre": "YSL Libre",
    "ysl libre": "YSL Libre",
    "black opium": "YSL Black Opium",
    "ysl black opium": "YSL Black Opium",
    "mon paris": "YSL Mon Paris",
    "l homme ysl": "YSL L'Homme",
    "ysl lhomme": "YSL L'Homme",

    // Guerlain
    "la petite robe noire": "Guerlain La Petite Robe Noire",
    "mon guerlain": "Mon Guerlain",
    "shalimar": "Guerlain Shalimar",
    "guerlain shalimar": "Guerlain Shalimar",

    // Creed
    "aventus": "Creed Aventus",
    "creed aventus": "Creed Aventus",
    "green irish tweed": "Creed Green Irish Tweed",
    "silver mountain water": "Creed Silver Mountain Water",
    "viking": "Creed Viking",
    "millesime imperial": "Creed Millésime Impérial",

    // Maison Margiela
    "replica beach walk": "Replica Beach Walk",
    "beach walk": "Maison Margiela Replica Beach Walk",
    "by the fireplace": "Maison Margiela Replica By the Fireplace",
    "jazz club": "Maison Margiela Replica Jazz Club",
    "flower market": "Maison Margiela Replica Flower Market",

    // Giorgio Armani
    "acqua di gio": "Armani Acqua di Giò",
    "acqua di gio profondo": "Armani Acqua di Giò Profondo",
    "si": "Armani Sì",
    "armani si": "Armani Sì",
    "armani code": "Armani Code",
    "code absolu": "Armani Code Absolu",

    // Versace
    "eros": "Versace Eros",
    "versace eros": "Versace Eros",
    "dylan blue": "Versace Dylan Blue",
    "versace dylan blue": "Versace Dylan Blue",
    "bright crystal": "Versace Bright Crystal",

    // Paco Rabanne
    "1 million": "Paco Rabanne 1 Million",
    "one million": "Paco Rabanne 1 Million",
    "invictus": "Paco Rabanne Invictus",
    "paco invictus": "Paco Rabanne Invictus",
    "olympea": "Paco Rabanne Olympéa",

    // Dolce & Gabbana
    "light blue": "Dolce & Gabbana Light Blue",
    "dg light blue": "Dolce & Gabbana Light Blue",
    "the one": "Dolce & Gabbana The One",
    "k by dolce": "Dolce & Gabbana K",

    // Lancôme
    "la vie est belle": "Lancôme La Vie Est Belle",
    "idole": "Lancôme Idôle",
    "tresor": "Lancôme Trésor",

    // Burberry
    "her burberry": "Burberry Her",
    "burberry her": "Burberry Her",
    "mr burberry": "Mr. Burberry",
    "brit rhythm": "Burberry Brit Rhythm",

    // Givenchy
    "gentlemen only": "Givenchy Gentlemen Only",
    "irresistible": "Givenchy Irresistible",
    "linterdit": "Givenchy L'Interdit",
    "linterdit givenchy": "Givenchy L'Interdit",

    // Hermès
    "terre dhermes": "Hermès Terre d'Hermès",
    "terre hermes": "Hermès Terre d'Hermès",
    "un jardin sur le nil": "Hermès Un Jardin sur le Nil",
    "twilly": "Hermès Twilly d'Hermès",

    // Montale
    "black aoud": "Montale Black Aoud",
    "roses musk": "Montale Roses Musk",
    "intense cafe": "Montale Intense Café",

    // Arabian / Niche
    "amouage interlude": "Amouage Interlude Man",
    "interlude man": "Amouage Interlude Man",
    "baccarat rouge 540": "Baccarat Rouge 540",
    "baccarat rouge": "Baccarat Rouge 540",
    "br540": "Baccarat Rouge 540",
    "oud ispahan": "Dior Oud Ispahan",
    "fahrenheit": "Dior Fahrenheit",
    "fahrenheit dior": "Dior Fahrenheit",
    "bvlgari man": "Bvlgari Man in Black",
    "man in black": "Bvlgari Man in Black",
    "polo ralph lauren": "Ralph Lauren Polo Blue",
    "polo blue": "Ralph Lauren Polo Blue",
  };

  if (CANONICAL[key]) return CANONICAL[key];

  // ── Title-case fallback ───────────────────────────────────────────────────
  // e.g. "DIOR HOMME INTENSE" → "Dior Homme Intense"
  // Preserve small words (de, di, la, le, les, by, for, of, and, &)
  const LOWERCASE_WORDS = new Set(["de", "di", "la", "le", "les", "du", "by", "for", "of", "and", "en", "et"]);
  return cleaned
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) =>
      i === 0 || !LOWERCASE_WORDS.has(word)
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word
    )
    .join(" ");
}


/**
 * generateSlug — URL-safe slug from perfume name.
 * "Dior Sauvage Elixir" → "dior-sauvage-elixir"
 */
function generateSlug(name) {
  return name
    .toLowerCase()
    .normalize("NFD")                    // Decompose accented chars
    .replace(/[\u0300-\u036f]/g, "")     // Strip diacritics
    .replace(/[^a-z0-9\s-]/g, "")       // Remove punctuation
    .replace(/\s+/g, "-")               // Spaces → hyphens
    .replace(/-+/g, "-")               // Collapse multiple hyphens
    .replace(/^-|-$/g, "");             // Trim edge hyphens
}


/**
 * buildFallbackSEO — Minimal structured SEO copy when the AI call fails.
 * Used only as a last resort — this is never shown when the API works.
 */
function buildFallbackSEO(name, house, profile, slug) {
  const article = /^[aeiou]/i.test(profile.gender) ? "An" : "A";
  const houseLabel = house ? `${house} ` : "";

  return [
    `## Short Description`,
    ``,
    `${article} ${profile.gender?.toLowerCase() || ""} fragrance by ${houseLabel}that opens ` +
    `with ${profile.top}, blooms into ${profile.heart}, and rests on ` +
    `a warm foundation of ${profile.base}.`,
    ``,
    `## Meta Title`,
    ``,
    `${name} ${profile.concentration} – ${house || "Luxury"} | Namarq Egypt`,
    ``,
    `## Meta Description`,
    ``,
    `Shop ${name} at Namarq. ${profile.gender} fragrance, ${profile.season}. ` +
    `Free delivery in Egypt on orders over 1500 EGP.`,
    ``,
    `## Product URL`,
    ``,
    `/product/${slug}`,
    ``,
    `## Tags`,
    ``,
    `${name}, ${house}, ${profile.gender}, ${profile.top}, ${profile.base}, ` +
    `${profile.season}, ${profile.occasion}, luxury perfume Egypt, Namarq`,
  ].join("\n");
}
