export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, gender, top, heart, base, vibe } = req.body;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are an SEO engine. Output EXACT format only."
          },
          {
            role: "user",
            content: `
You are the SEO Engine for Namarq Perfumes Egypt.

### MY INPUTS:
1. Product Name: ${name}
2. Gender: ${gender}
3. Top Notes: ${top}
4. Heart Notes: ${heart}
5. Base Notes: ${base}
6. Vibe/Occasion: ${vibe}

### OUTPUT FORMAT (Copy Exactly):

## Short description

New · SEO Recommended

[Count]/200 (Recommended)

[A tropical & exotic ${gender} fragrance. ${top}, ${heart} & ${base}. A bold statement scent at Namarq Egypt.]

## SEO settings

**Product URL**
../product/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
https://namarq-perfumes.online/en/product/all/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}

**Title**

60 characters max

${name} Perfume | Namarq Perfumes Egypt

**Description**

160 characters max

Shop ${name} at Namarq. A ${vibe} ${gender} fragrance. Free shipping on orders over 1500 LE.

STRICT: NO EXTRA TEXT
`
          }
        ]
      })
    });

    const data = await response.json();

    const output = data.choices?.[0]?.message?.content;

    if (!output) {
      return res.status(200).json({ output: "⚠️ AI error — try again" });
    }

    return res.status(200).json({ output });

  } catch (err) {
    return res.status(500).json({ error: "AI failed" });
  }
}
