export default async function handler(req, res) {
  try {

    if (req.method !== "POST") {
      return res.status(200).json({ output: "❌ Only POST allowed" });
    }

    // 🛡️ sanitize inputs
    const name   = (req.body?.name   || "").toString().trim();
    const gender = (req.body?.gender || "").toString().trim();
    const top    = (req.body?.top    || "").toString().trim();
    const heart  = (req.body?.heart  || "").toString().trim();
    const base   = (req.body?.base   || "").toString().trim();
    const vibe   = (req.body?.vibe   || "").toString().trim();

    // 🧠 slug
    const slug = (name || "perfume")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");

    // 🎯 AI prompt (strict format)
    const prompt = `
You are the SEO Engine for Namarq Perfumes Egypt.

### MY INPUTS:
Name: ${name}
Gender: ${gender}
Top: ${top}
Heart: ${heart}
Base: ${base}
Vibe: ${vibe}

### OUTPUT FORMAT (STRICT):

## Short description

New · SEO Recommended

[Count]/200 (Recommended)

[A luxury ${gender || "unisex"} fragrance with ${top}, ${heart} and ${base}.]

## SEO settings

**Product URL**
../product/${slug}
https://namarq-perfumes.online/en/product/all/${slug}

**Title**
${name || "Perfume"} Perfume | Namarq Perfumes Egypt

**Description**
Shop ${name || "this perfume"} at Namarq. A ${vibe || "luxury"} ${gender || "unisex"} fragrance. Free shipping on orders over 1500 LE.

STRICT: NO EXTRA TEXT
`;

    // 🧠 safe fetch
    async function callModel(model) {
      try {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
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

    // 🔥 models (auto switching)
    const models = [
      "google/gemini-2.0-flash-exp:free",
      "mistralai/mistral-7b-instruct:free",
      "openrouter/free"
    ];

    let output = null;

    for (let model of models) {
      const data = await callModel(model);

      const text = data?.choices?.[0]?.message?.content;

      if (text) {
        output = text;
        break;
      }
    }

    // 🧠 Smart fallback (luxury generator)
    function smartFallback() {

      const safeName   = name || "Signature Perfume";
      const safeGender = gender || "unisex";
      const safeVibe   = vibe || "elegant";

      const smartTop   = top   || "citrus, bergamot";
      const smartHeart = heart || "jasmine, rose";
      const smartBase  = base  || "amber, musk, woody accords";

      const description = `An exquisite ${safeVibe} ${safeGender} fragrance opening with ${smartTop}, evolving into a refined heart of ${smartHeart}, and settling into a rich base of ${smartBase}. Crafted to leave a lasting impression of elegance and depth.`;

      return `
## Short description

New · SEO Recommended

180/200 (Recommended)

${description}

## SEO settings

**Product URL**
../product/${slug}
https://namarq-perfumes.online/en/product/all/${slug}

**Title**

${safeName} Perfume | Namarq Perfumes Egypt

**Description**

Shop ${safeName} at Namarq. A ${safeVibe} ${safeGender} fragrance. Free shipping on orders over 1500 LE.
`;
    }

    // 🛟 fallback if AI fails
    if (!output) {
      output = smartFallback();
    }

    return res.status(200).json({ output });

  } catch (err) {
    return res.status(200).json({
      output: "❌ Fatal error:\n" + err.toString()
    });
  }
}
