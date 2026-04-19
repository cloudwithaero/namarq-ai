// =============================================================================
// Namarq AI – Perfume SEO Generator  v4.1
// api/generate.js  (Vercel Serverless Function – ES Module)
//
// Flow:
//   1. Search Fragrantica → get perfume page URL
//   2. Scrape perfume page → real notes via /notes/ href links + accords
//   3. OpenRouter AI (free models) → SEO content only
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

    // ── STAGE 1: Search Fragrantica ────────────────────────────────────────
    const searchUrl = `https://www.fragrantica.com/search/?query=${encodeURIComponent(rawName)}`;
    const searchHtml = await fetchPage(searchUrl, "https://www.fragrantica.com/");
    const perfumeUrl = extractFirstPerfumeUrl(searchHtml);

    if (!perfumeUrl) {
      return res.status(404).json({
        error: "Fragrance not found on Fragrantica. Check spelling and try again.",
        searched: rawName,
      });
    }

    // ── STAGE 2: Scrape Fragrantica Perfume Page ───────────────────────────
    const pageHtml = await fetchPage(perfumeUrl, searchUrl);
    const profile = scrapeFragrantica(pageHtml, perfumeUrl);

    const finalName = profile.canonicalName || name;
    const house = profile.house || "Unknown";
    const slug = finalName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const filledFields = ["top", "heart", "base", "accords"].filter(
      (k) => profile[k] && profile[k] !== "—" && profile[k].length > 0
    ).length;
    const confidence = filledFields >= 3 ? "high" : filledFields >= 1 ? "medium" : "low";

    // ── STAGE 3: SEO Generation via OpenRouter (free models) ──────────────
    const seoPrompt = `Write SEO content for the perfume "${finalName}" by ${house}.
Fragrance notes — Top: ${profile.top || "N/A"}. Heart: ${profile.heart || "N/A"}. Base: ${profile.base || "N/A"}.
Accords: ${profile.accords || "N/A"}. Gender: ${profile.gender || "N/A"}.

Output EXACTLY these 5 sections, nothing else before or after:

## Short Description
[Evocative luxury copy. HARD LIMIT: 160 characters max including spaces.]

## Meta Title
[Under 60 chars: ${finalName} – ${house} | Namarq Egypt]

## Meta Description
[Under 155 chars. Mention key notes and "Shop at Namarq Egypt".]

## Product URL
/product/${slug}

## SEO Tags
[12-15 comma separated tags: ${finalName}, ${house}, perfume Egypt, buy ${finalName} Egypt, Namarq, plus individual note names]`;

    let seoText = await callOpenRouter(OR_KEY, "google/gemini-2.0-flash-exp:free", seoPrompt, 0.7, 700);

    if (!seoText || !seoText.includes("## Short Description")) {
      seoText = await callOpenRouter(OR_KEY, "meta-llama/llama-3.1-8b-instruct:free", seoPrompt, 0.7, 700);
    }

    if (!seoText || !seoText.includes("## Short Description")) {
      seoText = buildFallbackSEO(finalName, house, profile, slug);
    }

    seoText = enforceShortDescLimit(seoText, 160);

    // ── Final Response ─────────────────────────────────────────────────────
    return res.status(200).json({
      name: finalName,
      house,
      slug,
      confidence,
      fragranticaUrl: perfumeUrl,
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
        character: profile.character || "—",
      },
      seo: seoText,
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal Server Error", detail: err.message });
  }
}

// =============================================================================
// FETCH
// =============================================================================

async function fetchPage(url, referer = "https://www.fragrantica.com/") {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: referer,
      "Cache-Control": "no-cache",
    },
  });
  return res.text();
}

// =============================================================================
// SEARCH RESULT PARSER
// =============================================================================

function extractFirstPerfumeUrl(html) {
  const match =
    html.match(/href="(https?:\/\/www\.fragrantica\.com\/perfume\/[^"]+\.html)"/) ||
    html.match(/href="(\/perfume\/[^"]+\.html)"/);
  if (!match) return null;
  const url = match[1];
  return url.startsWith("http") ? url : `https://www.fragrantica.com${url}`;
}

// =============================================================================
// MAIN SCRAPER
// =============================================================================

function scrapeFragrantica(html, url) {
  const profile = {};

  // ── Canonical Name ─────────────────────────────────────────────────────────
  const nameMatch =
    html.match(/<h1[^>]*itemprop="name"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i) ||
    html.match(/<h1[^>]*>\s*<span[^>]*itemprop="name"[^>]*>([^<]+)<\/span>/i) ||
    html.match(/<h1[^>]*>([^<]{2,80})<\/h1>/i);
  if (nameMatch) profile.canonicalName = decode(nameMatch[1].trim());

  // ── House (from URL path, then page override) ──────────────────────────────
  const urlMatch = url.match(/\/perfume\/([^/]+)\//);
  if (urlMatch) profile.house = decode(urlMatch[1].replace(/-/g, " "));

  const houseMatch =
    html.match(/itemprop="brand"[\s\S]{0,300}?itemprop="name"[^>]*>([^<]+)<\/span>/i) ||
    html.match(/<a[^>]+href="\/designers\/[^"]*"[^>]*>\s*([^<]{2,60})\s*<\/a>/i);
  if (houseMatch) profile.house = decode(houseMatch[1].trim());

  // ── Gender ─────────────────────────────────────────────────────────────────
  const genderMatch = html.match(/\bfor\s+(women\s+and\s+men|men\s+and\s+women|women|men|unisex)\b/i);
  if (genderMatch) {
    const g = genderMatch[1].toLowerCase();
    profile.gender =
      g.includes("women") && g.includes("men") ? "Unisex"
      : g === "unisex" ? "Unisex"
      : g === "women" ? "Women"
      : "Men";
  }

  // ── Concentration ──────────────────────────────────────────────────────────
  const concMatch = html.match(
    /\b(Eau\s+de\s+Parfum|Eau\s+de\s+Toilette|Eau\s+de\s+Cologne|Parfum|Extrait\s+de\s+Parfum)\b/i
  );
  if (concMatch) profile.concentration = concMatch[1].replace(/\s+/g, " ").trim();

  // ── Notes: extract via /notes/ href links split by pyramid position ─────────
  // This is the most reliable method — Fragrantica links every note to /notes/name-id.html
  const pyramid = extractPyramidSection(html);
  if (pyramid) {
    profile.top   = extractNotesByHref(pyramid.top);
    profile.heart = extractNotesByHref(pyramid.heart);
    profile.base  = extractNotesByHref(pyramid.base);
  }

  // Fallback: use character-position splitting if pyramid div not found
  if (!profile.top && !profile.heart && !profile.base) {
    const allNotes = extractAllNoteLinks(html);
    const split = splitNotesByPosition(html, allNotes);
    profile.top   = split.top;
    profile.heart = split.heart;
    profile.base  = split.base;
  }

  // ── Accords ────────────────────────────────────────────────────────────────
  profile.accords = extractAccords(html);

  // ── Longevity ──────────────────────────────────────────────────────────────
  for (const term of ["very long lasting", "long lasting", "moderate", "weak", "poor"]) {
    if (html.toLowerCase().includes(term)) {
      profile.longevity = capitalize(term);
      break;
    }
  }

  // ── Sillage ────────────────────────────────────────────────────────────────
  const sillIdx = html.toLowerCase().indexOf("sillage");
  if (sillIdx !== -1) {
    const chunk = html.slice(sillIdx, sillIdx + 500).toLowerCase();
    for (const term of ["enormous", "strong", "moderate", "soft", "intimate"]) {
      if (chunk.includes(term)) { profile.sillage = capitalize(term); break; }
    }
  }

  // ── Season ─────────────────────────────────────────────────────────────────
  const seasonMatch = html.match(/season[\s\S]{0,3000}?(?=<\/div>\s*<\/div>)/i);
  if (seasonMatch) {
    const s = seasonMatch[0];
    const seasons = [];
    if (/spring/i.test(s))       seasons.push("Spring");
    if (/summer/i.test(s))       seasons.push("Summer");
    if (/fall|autumn/i.test(s))  seasons.push("Fall");
    if (/winter/i.test(s))       seasons.push("Winter");
    if (seasons.length) profile.season = seasons.join(", ");
  }

  return profile;
}

// =============================================================================
// NOTE EXTRACTION HELPERS
// =============================================================================

function extractPyramidSection(html) {
  // Find pyramid container
  const startIdx = html.search(/<div[^>]*class="[^"]*pyramid[^"]*"/i);
  const chunk = startIdx !== -1 ? html.slice(startIdx, startIdx + 8000) : html;

  const topIdx   = indexOfCI(chunk, "top notes");
  const heartIdx = Math.max(indexOfCI(chunk, "middle notes"), indexOfCI(chunk, "heart notes"));
  const baseIdx  = indexOfCI(chunk, "base notes");

  if (topIdx === -1 && heartIdx === -1 && baseIdx === -1) return null;

  const end = chunk.length;
  return {
    top:   topIdx   !== -1 ? chunk.slice(topIdx,   heartIdx !== -1 ? heartIdx : baseIdx !== -1 ? baseIdx : end) : "",
    heart: heartIdx !== -1 ? chunk.slice(heartIdx, baseIdx  !== -1 ? baseIdx  : end) : "",
    base:  baseIdx  !== -1 ? chunk.slice(baseIdx,  end) : "",
  };
}

function extractNotesByHref(chunk) {
  if (!chunk) return "";
  // <a href="/notes/bergamot-26.html">Bergamot</a>
  const matches = [...chunk.matchAll(/href="\/notes\/[^"]+\.html"[^>]*>\s*([^<]{1,40})\s*<\/a>/gi)];
  const notes = matches
    .map((m) => decode(m[1].trim()))
    .filter((n) => n.length > 1 && n.length < 40 && !/^\d+$/.test(n));
  return [...new Set(notes)].join(", ");
}

function extractAllNoteLinks(html) {
  const matches = [...html.matchAll(/href="\/notes\/([^"]+)\.html"[^>]*>\s*([^<]{1,40})\s*<\/a>/gi)];
  return matches
    .map((m) => ({ slug: m[1], name: decode(m[2].trim()), pos: m.index }))
    .filter((n) => n.name.length > 1 && !/^\d+$/.test(n.name));
}

function splitNotesByPosition(html, allNotes) {
  const topIdx   = indexOfCI(html, "top notes");
  const heartIdx = Math.max(indexOfCI(html, "middle notes"), indexOfCI(html, "heart notes"));
  const baseIdx  = indexOfCI(html, "base notes");
  const result   = { top: "", heart: "", base: "" };
  if (!allNotes.length) return result;

  const top   = allNotes.filter((n) => topIdx   !== -1 && n.pos > topIdx   && (heartIdx === -1 || n.pos < heartIdx) && (baseIdx === -1 || n.pos < baseIdx));
  const heart = allNotes.filter((n) => heartIdx !== -1 && n.pos > heartIdx && (baseIdx  === -1 || n.pos < baseIdx));
  const base  = allNotes.filter((n) => baseIdx  !== -1 && n.pos > baseIdx);

  result.top   = [...new Set(top.map((n) => n.name))].join(", ");
  result.heart = [...new Set(heart.map((n) => n.name))].join(", ");
  result.base  = [...new Set(base.map((n) => n.name))].join(", ");
  return result;
}

// =============================================================================
// ACCORD EXTRACTION
// =============================================================================

function extractAccords(html) {
  // Fragrantica accord bars: colored bar div followed by name div
  // <div style="height:72%..."></div><div>Fresh</div>
  const accordSection = html.match(/accord[\s\S]{0,6000}?(?=<\/div>\s*<\/div>\s*<\/div>)/i);
  const chunk = accordSection ? accordSection[0] : html;

  const barMatches = [
    ...chunk.matchAll(
      /<div[^>]*style="[^"]*height\s*:\s*\d+[^"]*"[^>]*>[\s\S]{0,300}?<\/div>\s*<div[^>]*>\s*([^<]{2,30})\s*<\/div>/gi
    ),
  ];

  if (barMatches.length > 0) {
    const accords = barMatches
      .map((m) => decode(m[1].trim()))
      .filter((a) => a.length > 1 && a.length < 40 && !/^\d/.test(a))
      .slice(0, 10);
    if (accords.length) return [...new Set(accords)].join(", ");
  }

  // Fallback: class="accord" divs
  const classDivs = [...html.matchAll(/class="[^"]*accord[^"]*"[^>]*>[\s\S]{0,200}?<div[^>]*>\s*([^<]{2,30})\s*<\/div>/gi)];
  if (classDivs.length) {
    const accords = classDivs
      .map((m) => decode(m[1].trim()))
      .filter((a) => a.length > 1 && !/^\d/.test(a))
      .slice(0, 10);
    if (accords.length) return [...new Set(accords)].join(", ");
  }

  return "";
}

// =============================================================================
// UTILS
// =============================================================================

function indexOfCI(str, search) {
  return str.toLowerCase().indexOf(search.toLowerCase());
}

function decode(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .trim();
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// =============================================================================
// OPENROUTER
// =============================================================================

async function callOpenRouter(apiKey, model, prompt, temperature = 0.7, maxTokens = 700) {
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

// =============================================================================
// SEO HELPERS
// =============================================================================

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

function buildFallbackSEO(name, house, profile, slug) {
  const top  = profile.top  || "citrus and spice";
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
