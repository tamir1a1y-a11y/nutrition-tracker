export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { description } = req.body;

  if (!description) {
    return res.status(400).json({ error: "No description provided" });
  }

  try {
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
        system: `You are a precise nutrition expert. Parse the food description and return ONLY a valid JSON object, no markdown, no backticks, no preamble:
{"items":[{"name":"string","quantity":"string","calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0}],"totals":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0}}
All macros in grams (numbers), calories in kcal (number). Use accurate values. If quantity is missing, use a typical serving.`,
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