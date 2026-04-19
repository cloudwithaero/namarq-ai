export default async function handler(req, res) {

  // allow only POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, gender, top, heart, base, vibe } = req.body;

  // safety fallback
  if (!name) {
    return res.status(400).json({ error: "Missing product name" });
  }

  const prompt = `
You are the SEO Engine for Namarq Perfumes Egypt.

I will give you ONLY 6 inputs about a perfume.

### MY INPUTS:
1. Product Name: ${name}
2. Gender: ${gender}
3. Top Notes: ${top}
4. Heart Notes: ${heart}
5. Base Notes: ${base}
6. Vibe/Occasion: ${vibe}

### YOUR OUTPUT FORMAT (Copy Exactly):

## Short description

New · SEO Recommended

[Count]/200 (Recommended)

[A tropical & exotic ${gender} fragrance. ${top}, ${heart} & ${base}. A bold statement scent at Namarq Egypt.]

## SEO settings

**Product URL**
../product/[slug]
https://namarq-perfumes.online/en/product/all/[slug]

**Title**

60 characters max

[${name} Perfume | Namarq Perfumes Egypt]

**Description**

160 characters max

[Shop ${name} at Namarq. A ${vibe} ${gender} fragrance. Free shipping on orders over 1500 LE.]

### RULES:
- English ONLY
- NO extra text
`;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.3",
        input: prompt
      })
    });

    const data = await response.json();

    const output =
      data.output?.[0]?.content?.[0]?.text || "Generation failed";

    // simple validation (important)
    if (!output.includes("## Short description")) {
      return res.status(200).json({
        output: "⚠️ AI format error — try again"
      });
    }

    return res.status(200).json({ output });

  } catch (error) {
    return res.status(500).json({
      error: "AI request failed"
    });
  }
}
