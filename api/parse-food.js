export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { description } = req.body;
    if (!description) return res.status(400).json({ error: "No description provided" });

    if (!process.env.ANTHROPIC_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_KEY environment variable is not set" });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: `You are a precise nutrition expert. Return ONLY valid JSON, no markdown, no backticks, no extra text whatsoever:
{"items":[{"name":"string","quantity":"string","calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0}],"totals":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0}}
All values must be numbers. Calories in kcal. All macros in grams.`,
        messages: [{ role: "user", content: description }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: `Anthropic API error ${response.status}: ${errText}` });
    }

    const data = await response.json();

    if (!data.content || data.content.length === 0) {
      return res.status(500).json({ error: "Empty response from Anthropic API" });
    }

    const text = data.content.map(b => b.text || "").join("").trim();
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ error: "Parsing failed: " + err.message });
  }
}