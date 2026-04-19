export default async function handler(req, res) {
  // 🛡️ دايمًا رجّع response مهما حصل
  try {

    if (req.method !== "POST") {
      return res.status(200).json({ output: "❌ Only POST allowed" });
    }

    const name   = (req.body?.name   || "Perfume").toString();
    const gender = (req.body?.gender || "unisex").toString();
    const top    = (req.body?.top    || "").toString();
    const heart  = (req.body?.heart  || "").toString();
    const base   = (req.body?.base   || "").toString();
    const vibe   = (req.body?.vibe   || "").toString();

    const prompt = `
Generate short SEO perfume description.

Name: ${name}
Gender: ${gender}
Top: ${top}
Heart: ${heart}
Base: ${base}
Vibe: ${vibe}
`;

    // 🧠 helper آمن
    async function safeFetch(model) {
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

    // 🔥 موديلات (واحد منهم هيشتغل)
    const models = [
      "google/gemini-2.0-flash-exp:free",
      "mistralai/mistral-7b-instruct:free",
      "openrouter/free"
    ];

    let output = null;

    for (let model of models) {
      const data = await safeFetch(model);

      const text = data?.choices?.[0]?.message?.content;

      if (text) {
        output = text;
        break;
      }
    }

    // 🛟 fallback لو كله فشل
    if (!output) {
      output = `## Short description

New · SEO Recommended

120/200 (Recommended)

A ${vibe} ${gender} fragrance featuring ${top}, ${heart}, and ${base}. A refined scent from Namarq Egypt.`;
    }

    return res.status(200).json({ output });

  } catch (err) {
    return res.status(200).json({
      output: "❌ Fatal error:\n" + err.toString()
    });
  }
}
