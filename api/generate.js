export default async function handler(req, res) {

  try {

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { name, gender, top, heart, base, vibe } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({ output: "❌ Missing API Key" });
    }

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
            role: "user",
            content: `Create SEO text for perfume ${name}`
          }
        ]
      })
    });

    const data = await response.json();

    // 👇 أهم سطر
    const output = data?.choices?.[0]?.message?.content;

    if (!output) {
      return res.status(200).json({
        output: "❌ API returned no content\n" + JSON.stringify(data)
      });
    }

    return res.status(200).json({ output });

  } catch (err) {
    return res.status(200).json({
      output: "❌ Server crash:\n" + err.toString()
    });
  }
}
