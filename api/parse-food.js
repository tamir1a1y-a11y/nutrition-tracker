export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { description } = req.body;
    if (!description) return res.status(400).json({ error: "No description provided" });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: `You are a precise nutrition expert. Return ONLY valid JSON, no markdown, no backticks:
{"items":[{"name":"string","quantity":"string","calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0}],"totals":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0}}`,
        messages: [{ role: "user", content: description }]
      })
    });

    const data = await response.json();
    const text = data.content.map(b => b.text || "").join("").trim();
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: "Parsing failed: " + err.message });
  }
}