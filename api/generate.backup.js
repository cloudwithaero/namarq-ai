export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({ output: "❌ Only POST allowed" });
    }

    const name = (req.body?.name || "").toString().trim();
    if (!name) {
      return res.status(200).json({ output: "❌ Enter perfume name" });
    }

    const OR_KEY = process.env.OPENROUTER_API_KEY;

    // ---------- Helper: call model safely ----------
    async function ask(model, prompt) {
      try {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OR_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }]
          })
        });
        return await r.json();
      } catch (e) {
        return { error: e.toString() };
      }
    }

    // ---------- STEP 1: Deep search (attempt A) ----------
    const fetchPrompt = `
You are a perfume expert.

Task: Retrieve ACCURATE data for "${name}".

Rules:
- Use well-known public knowledge (Fragrantica / Parfumo style)
- Prefer real known notes if the perfume is popular
- If uncertain, return best-known accords instead of guessing

Return ONLY JSON:

{
 "top": "...",
 "heart": "...",
 "base": "...",
 "gender": "...",
 "vibe": "..."
}
NO EXTRA TEXT
`;

    const a = await ask("google/gemini-2.0-flash-exp:free", fetchPrompt);
    const b = await ask("mistralai/mistral-7b-instruct:free", fetchPrompt);

    function parse(txt) {
      try { return JSON.parse(txt); } catch { return {}; }
    }

    const p1 = parse(a?.choices?.[0]?.message?.content || "{}");
    const p2 = parse(b?.choices?.[0]?.message?.content || "{}");

    // ---------- STEP 2: Merge + confidence ----------
    function pick(a, b, fallback) {
      if (a && b && a === b) return { v: a, s: 2 };
      if (a && b && a !== b) return { v: a, s: 1 };
      if (a) return { v: a, s: 1 };
      if (b) return { v: b, s: 1 };
      return { v: fallback, s: 0 };
    }

    const topP = pick(p1.top, p2.top, "citrus, fresh");
    const heartP = pick(p1.heart, p2.heart, "aromatic, spicy");
    const baseP = pick(p1.base, p2.base, "woody, musk");
    const genderP = pick(p1.gender, p2.gender, "unisex");
    const vibeP = pick(p1.vibe, p2.vibe, "elegant");

    const score = topP.s + heartP.s + baseP.s;
    let confidence = "Low";
    if (score >= 5) confidence = "High";
    else if (score >= 3) confidence = "Medium";

    const top = topP.v;
    const heart = heartP.v;
    const base = baseP.v;
    const gender = genderP.v;
    const vibe = vibeP.v;

    // ---------- STEP 3: SEO generation (luxury + grammar) ----------
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    const seoPrompt = `
You are a luxury perfume copywriter (Dior/Tom Ford style).

Write premium, natural English.

Rules:
- Use correct grammar (An vs A)
- Avoid robotic listing
- Blend notes smoothly
- Keep tone elegant and refined

Data:
Name: ${name}
Gender: ${gender}
Top: ${top}
Heart: ${heart}
Base: ${base}
Vibe: ${vibe}

OUTPUT:

## Short description

New · SEO Recommended

150/200 (Recommended)

[Write a smooth, elegant description]

## SEO settings

**Product URL**
../product/${slug}

**Title**
${name} Perfume | Namarq Perfumes Egypt

**Description**
Shop ${name} at Namarq. A refined ${gender} fragrance. Free shipping on orders over 1500 LE.

## Data Confidence

${confidence}

STRICT: NO EXTRA TEXT
`;

    const seo = await ask("google/gemini-2.0-flash-exp:free", seoPrompt);
    let output = seo?.choices?.[0]?.message?.content;

    // ---------- FALLBACK ----------
    if (!output) {
      output = `
## Short description

New · SEO Recommended

150/200 (Recommended)

An elegant ${gender} fragrance opening with ${top}, evolving into ${heart}, and settling into ${base}.

## SEO settings

**Product URL**
../product/${slug}

**Title**
${name} Perfume | Namarq Perfumes Egypt

**Description**
Shop ${name} at Namarq. A refined ${gender} fragrance. Free shipping on orders over 1500 LE.

## Data Confidence

${confidence}
`;
    }

    return res.status(200).json({ output });

  } catch (err) {
    return res.status(200).json({
      output: "❌ Fatal error:\n" + err.toString()
    });
  }
}
