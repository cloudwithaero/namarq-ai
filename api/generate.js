export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { name, gender, top, heart, base, vibe } = req.body;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openrouter/free", // 🔥 مجاني
        messages: [
          {
            role: "user",
            content: `
You are the SEO Engine for Namarq Perfumes Egypt.

Product: ${name}
Gender: ${gender}
Top: ${top}
Heart: ${heart}
Base: ${base}
Vibe: ${vibe}

Generate SEO content in structured format.
`
          }
        ]
      })
    });

    const data = await response.json();

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
