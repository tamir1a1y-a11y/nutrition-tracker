export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { foodLog, weightLog, workoutLog, targets } = req.body;

    if (!foodLog || foodLog.length === 0) {
      return res.status(400).json({ error: "No data to analyze yet. Log a few days of meals first." });
    }

    if (!process.env.ANTHROPIC_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_KEY not set" });
    }

    const prompt = `You are a personal nutrition and fitness coach. Analyze this user's tracking data and give personalized, specific, actionable advice.

USER PROFILE:
- Goal: Body recomposition (fat loss + muscle gain)
- Starting weight: 110kg, Target: ~92kg at 14% body fat
- Daily targets: ${targets.calories} kcal, ${targets.protein}g protein, ${targets.carbs}g carbs, ${targets.fat}g fat, ${targets.fiber}g fiber
- Training: 4 sessions/week (strength + swimming)

FOOD LOG (last 14 days):
${JSON.stringify(foodLog, null, 2)}

WEIGHT LOG:
${JSON.stringify(weightLog, null, 2)}

WORKOUT LOG:
${JSON.stringify(workoutLog, null, 2)}

Please provide:
1. A brief overall assessment (2-3 sentences)
2. Top 3 specific things they're doing well
3. Top 3 specific things to improve (with concrete actionable advice)
4. One meal or habit suggestion tailored to their patterns
5. A realistic expectation for the next 2-4 weeks if they follow your advice

Be direct, specific, and encouraging. Reference actual numbers and patterns from their data. Keep the total response under 400 words.`;

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
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: `Anthropic API error: ${errText}` });
    }

    const data = await response.json();
    const text = data.content.map(b => b.text || "").join("").trim();
    return res.status(200).json({ analysis: text });

  } catch (err) {
    return res.status(500).json({ error: "Analysis failed: " + err.message });
  }
}