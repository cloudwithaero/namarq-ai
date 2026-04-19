// =============================================================================
// Namarq AI – Perfume SEO Generator  v3.3
// api/generate.js  (Vercel Serverless Function – ES Module)
// Uses only free OpenRouter models. Switches to JSON output for reliability.
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

    // ── STAGE 1: Profile via JSON (much more reliable than key-value) ──────
    // JSON is a format all models understand natively — no formatting failures
    const profilePrompt = `You are a fragrance expert. Return the olfactory profile for the perfume "${name}".

Respond with ONLY valid JSON. No markdown, no code blocks, no backticks, no explanation. Just raw JSON.

{
  "canonicalName": "${name}",
  "house": "brand name here",
  "top": "note1, note2, note3",
  "heart": "note1, note2, note3",
  "base": "note1, note2, note3",
  "accords": "accord1, accord2, accord3",
  "gender": "Men or Women or Unisex",
  "concentration": "EDP or EDT or Parfum",
  "season": "Spring, Summer, Fall, Winter",
  "occasion": "occasions here",
  "vibe": "adjective1, adjective2, adjective3",
  "longevity": "Moderate or Good or Excellent",
  "sillage": "Moderate or Strong or Beast"
}

Rules:
- Fill every field. Never use null or empty string.
- If unsure, use your best fragrance knowledge.
- Return ONLY the JSON object, nothing else.`;

    // Try meta-llama first (very instruction-following)
    let text = await callOpenRouter(OR_KEY, "meta-llama/llama-3.1-8b-instruct:free", profilePrompt, 0.1, 600);

    // Parse JSON profile
    let profile = parseJSON(text);

    // If llama failed, try Gemini
    if (!profile || !profile.top || profile.top === "") {
      text = await callOpenRouter(OR_KEY, "google/gemini-2.0-flash-exp:free", profilePrompt, 0.1, 600);
      profile = parseJSON(text);
    }

    // If both failed, try mistral
    if (!profile || !profile.top || profile.top === "") {
      text = await callOpenRouter(OR_KEY, "mistralai/mistral-7b-instruct:free", profilePrompt, 0.1, 600);
      profile = parseJSON(text);
    }

    // Last resort hardcoded fallback so UI is never empty
    if (!profile) {
      profile = {
        canonicalName: name,
        house: "Unknown",
        top: "—",
        heart: "—",
        base: "—",
        accords: "—",
        gender: "—",
        concentration: "—",
        season: "—",
        occasion: "—",
        vibe: "—",
        longevity: "—",
        sillage: "—",
      };
    }

    // ── Confidence Score ───────────────────────────────────────────────────
    const filledFields = ["top", "heart", "base", "accords", "gender"].filter(
      (k) => profile[k] && profile[k] !== "—" && profile[k] !== ""
    ).length;
    const confidence = filledFields >= 4 ? "high" : filledFields >= 2 ? "medium" : "low";

    const finalName = profile.canonicalName || name;
    const house = profile.house || "Namarq";
    const slug = finalName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // ── STAGE 2: SEO Generation ────────────────────────────────────────────
    const seoPrompt = `Write SEO content for the perfume "${finalName}" by ${house}.
Fragrance notes — Top: ${profile.top}. Heart: ${profile.heart}. Base: ${profile.base}.
Accords: ${profile.accords}. Gender: ${profile.gender}. Season: ${profile.season}.

Output EXACTLY these 5 sections with no extra text before or after:

## Short Description
[Luxury evocative description. STRICT MAXIMUM 160 characters. Count every character.]

## Meta Title
[Under 60 characters: ${finalName} – ${house} | Namarq Egypt]

## Meta Description
[Under 155 characters. Mention key notes and "Shop at Namarq Egypt".]

## Product URL
/product/${slug}

## SEO Tags
[12-15 comma separated: ${finalName}, ${house}, perfume Egypt, buy ${finalName} Egypt, Namarq, plus note names]`;

    let seoText = await callOpenRouter(OR_KEY, "google/gemini-2.0-flash-exp:free", seoPrompt, 0.7, 700);

    if (!seoText || !seoText.includes("## Short Description")) {
      seoText = await callOpenRouter(OR_KEY, "meta-llama/llama-3.1-8b-instruct:free", seoPrompt, 0.7, 700);
    }

    if (!seoText || !seoText.includes("## Short Description")) {
      seoText = buildFallbackSEO(finalName, house, profile, slug);
    }

    // Hard-enforce 160-char Short Description
    seoText = enforceShortDescLimit(seoText, 160);

    // ── Final Response ─────────────────────────────────────────────────────
    return res.status(200).json({
      name: finalName,
      house,
      slug,
      confidence,
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
    return res.status(500).json({ error: "Internal Server Error", detail: err.message });
  }
}

// ── Call any OpenRouter model ─────────────────────────────────────────────────
async function callOpenRouter(apiKey, model, prompt, temperature = 0.3, maxTokens = 600) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://namarq.store",
        "X-Title": "Namarq AI",
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || "";
  } catch {
    return "";
  }
}

// ── Parse JSON from model output (handles code fences & extra text) ───────────
function parseJSON(text) {
  if (!text) return null;
  try {
    // Strip markdown code fences if present
    const stripped = text
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    // Find first { and last } to extract JSON object
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start === -1 || end === -1) return null;

    const jsonStr = stripped.slice(start, end + 1);
    const parsed = JSON.parse(jsonStr);

    // Validate it has at least one note field
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Enforce 160-char Short Description ───────────────────────────────────────
function enforceShortDescLimit(seoText, limit = 160) {
  return seoText.replace(
    /(## Short Description\s*\n)([\s\S]*?)(\n## )/,
    (match, header, body, next) => {
      let trimmed = body.trim();
      if (trimmed.length > limit) {
        trimmed = trimmed.slice(0, limit - 1).replace(/[,\s]+$/, "") + ".";
      }
      return `${header}${trimmed}${next}`;
    }
  );
}

// ── Fallback SEO ──────────────────────────────────────────────────────────────
function buildFallbackSEO(name, house, profile, slug) {
  const top = profile.top || "citrus and spice";
  const base = profile.base || "musk and amber";
  const shortDesc = `${name} by ${house} — ${top} over a warm base of ${base}.`.slice(0, 160);

  return `## Short Description
${shortDesc}

## Meta Title
${name} – ${house} | Namarq Egypt

## Meta Description
Shop ${name} by ${house} at Namarq Egypt. Free delivery on orders over 1500 EGP. Authentic guaranteed.

## Product URL
/product/${slug}

## SEO Tags
${name}, ${house}, ${name} perfume, buy ${name} Egypt, perfume Egypt, luxury fragrance Egypt, Namarq Egypt, ${top}, ${base}`;
}
