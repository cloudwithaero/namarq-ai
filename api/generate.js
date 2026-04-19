export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, gender, top, heart, base, vibe } = req.body;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content: "You are an SEO engine. Output EXACT format only. No extra text."
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

### YOUR OUTPUT FORMAT (Copy Exactly):

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
`
          }
        ]
      })
    });

    const data = await r.json();

    // 👇 أهم سطرين debugging
    if (!data.choices) {
      return res.status(200).json({
        output: "❌ API error:\n" + JSON.stringify(data, null, 2)
      });
    }

    const output = data.choices[0].message.content;

    return res.status(200).json({ output });

  } catch (e) {
    return res.status(500).json({ error: "Server crashed" });
  }
}
