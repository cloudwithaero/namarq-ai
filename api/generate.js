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

    // 🔹 Helper
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

    // 🔥 STEP 1 — Fetch perfume data (attempt 1)
    const prompt1 = `
Give accurate perfume data for: ${name}

Return JSON only:
{
 "top": "...",
 "heart": "...",
 "base": "...",
 "gender": "...",
 "vibe": "..."
}
NO EXTRA TEXT
`;

    let data1 = await ask("google/gemini-2.0-flash-exp:free", prompt1);
    let text1 = data1?.choices?.[0]?.message?.content || "{}";

    // 🔥 STEP 2 — Fetch again (attempt 2)
    let data2 = await ask("mistralai/mistral-7b-instruct:free", prompt1);
    let text2 = data2?.choices?.[0]?.message?.content || "{}";

    function parseJSON(txt) {
      try { return JSON.parse(txt); } catch { return {}; }
    }

    const p1 = parseJSON(text1);
    const p2 = parseJSON(text2);

    // 🔥 STEP 3 — Merge + validate
    function pick(a, b, fallback) {
      if (a && b && a === b) return { value: a, score: 2 };
      if (a && b && a !== b) return { value: a, score: 1 };
      if (a) return { value: a, score: 1 };
      if (b) return { value: b, score: 1 };
      return { value: fallback, score: 0 };
    }

    const topPick = pick(p1.top, p2.top, "citrus, fresh");
    const heartPick = pick(p1.heart, p2.heart, "floral notes");
    const basePick = pick(p1.base, p2.base, "woody, musk");
    const genderPick = pick(p1.gender, p2.gender, "unisex");
    const vibePick = pick(p1.vibe, p2.vibe, "elegant");

    const totalScore = topPick.score + heartPick.score + basePick.score;

    let confidence = "Low";
    if (totalScore >= 5) confidence = "High";
    else if (totalScore >= 3) confidence = "Medium";

    const top = topPick.value;
    const heart = heartPick.value;
    const base = basePick.value;
    const gender = genderPick.value;
    const vibe = vibePick.value;

    // 🔥 STEP 4 — Generate SEO
    const slug = (name || "perfume")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");

    const seoPrompt = `
You are the SEO Engine for Namarq Perfumes Egypt.

### MY INPUTS:
Product Name: ${name}
Gender: ${gender}
Top Notes: ${top}
Heart Notes: ${heart}
Base Notes: ${base}
Vibe/Occasion: ${vibe}

### OUTPUT FORMAT (STRICT):

## Short description

New · SEO Recommended

150/200 (Recommended)

A luxury ${gender} fragrance with ${top}, ${heart} and ${base}. A bold statement scent at Namarq Egypt.

## SEO settings

**Product URL**
../product/${slug}
https://namarq-perfumes.online/en/product/all/${slug}

**Title**

${name} Perfume | Namarq Perfumes Egypt

**Description**

Shop ${name} at Namarq. A ${vibe} ${gender} fragrance. Free shipping on orders over 1500 LE.

## Data Confidence

${confidence}

STRICT: NO EXTRA TEXT
`;

    let seoData = await ask("google/gemini-2.0-flash-exp:free", seoPrompt);
    let output = seoData?.choices?.[0]?.message?.content;

    // 🛟 fallback
    if (!output) {
      output = `
## Short description

New · SEO Recommended

150/200 (Recommended)

A ${vibe} ${gender} fragrance featuring ${top}, ${heart}, and ${base}. A refined scent from Namarq Egypt.

## SEO settings

**Product URL**
../product/${slug}

**Title**
${name} Perfume | Namarq Perfumes Egypt

**Description**
Shop ${name} at Namarq. A ${vibe} ${gender} fragrance. Free shipping on orders over 1500 LE.

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
