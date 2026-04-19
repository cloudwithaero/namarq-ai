export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // 🛡️ تأمين القيم (مافيش undefined)
    const name   = (req.body?.name   || "").trim();
    const gender = (req.body?.gender || "").trim();
    const top    = (req.body?.top    || "").trim();
    const heart  = (req.body?.heart  || "").trim();
    const base   = (req.body?.base   || "").trim();
    const vibe   = (req.body?.vibe   || "").trim();

    // 🛡️ slug آمن (مايكراش)
    const slug = (name || "product")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const prompt = `
You are the SEO Engine for Namarq Perfumes Egypt.

### MY INPUTS:
1. Product Name: ${name}
2. Gender: ${gender}
3. Top Notes: ${top}
4. Heart Notes: ${heart}
5. Base Notes: ${base}
6. Vibe/Occasion: ${vibe}

### YOUR OUTPUT FORMAT (STRICT):

## Short description

New · SEO Recommended

[Count]/200 (Recommended)

[A tropical & exotic ${gender || "unisex"} fragrance. ${top}, ${heart} & ${base}. A bold statement scent at Namarq Egypt.]

## SEO settings

**Product URL**
../product/${slug}
https://namarq-perfumes.online/en/product/all/${slug}

**Title**

60 characters max

${name || "Perfume"} Perfume | Namarq Perfumes Egypt

**Description**

160 characters max

Shop ${name || "this perfume"} at Namarq. A ${vibe || "refined"} ${gender || "unisex"} fragrance. Free shipping on orders over 1500 LE.

STRICT: NO EXTRA TEXT
`;

    async function callModel(model) {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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

      return await response.json();
    }

    // 🟢 Primary
    let data = await callModel("meta-llama/llama-3-8b-instruct:free");

    // 🔁 Fallback لو 429
    if (data?.error?.code === 429) {
      data = await callModel("google/gemini-2.0-flash-exp:free");
    }

    const output = data?.choices?.[0]?.message?.content;

    if (!output) {
      return res.status(200).json({
        output: "❌ No response:\n" + JSON.stringify(data, null, 2)
      });
    }

    return res.status(200).json({ output });

  } catch (err) {
    return res.status(200).json({
      output: "❌ Server error:\n" + err.toString()
    });
  }
}
