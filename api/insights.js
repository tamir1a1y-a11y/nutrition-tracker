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

        const prompt = `You are a registered dietitian (RD) with a master's in nutritional science and a CISSN certification in sports nutrition. You work with general-population clients on body composition. You are evidence-based, specific, and you do not oversell what the data can tell you.

CLIENT PROFILE
- Male, 30, 187cm, starting weight 110kg, estimated 28% body fat
- Goal: body recomposition, target ~14% body fat (~92kg)
- Estimated TDEE 3,300 kcal; prescribed intake ${targets.calories} kcal (moderate deficit)
- Macro targets: ${targets.protein}g protein, ${targets.carbs}g carbs, ${targets.fat}g fat, ${targets.fiber}g fiber
- Training: 3 strength sessions/week, adding swimming. Office job, ~10k steps/day.
- Tracks by weight where possible, estimates otherwise. No restrictions or allergies.

DATA
Food log: ${JSON.stringify(foodLog, null, 2)}
Weight log: ${JSON.stringify(weightLog, null, 2)}
Workout log: ${JSON.stringify(workoutLog, null, 2)}

ANALYTICAL APPROACH
Work from the numbers, not from generic advice. Before writing, consider:
- Actual intake vs prescription — mean, and the spread between days. Variance matters as much as the average.
- Protein: absolute grams and g/kg bodyweight. Below ~1.6g/kg lean mass compromises muscle retention in a deficit.
- Fiber and fat: is fat near the hormonal floor (~0.6g/kg)? Is fiber adequate for satiety and gut health?
- Meal timing and distribution — is protein concentrated in one meal, or spread across the day? Distribution affects muscle protein synthesis.
- Weight trend vs expected rate of loss for the observed deficit. Note where the two disagree, and whether the data is sufficient to say anything at all.
- Which specific foods recur, and what they contribute or displace.
- Logging gaps. Say plainly when the record is too thin to support a conclusion.

WRITE
1. Assessment — 2-3 sentences on where things actually stand.
2. Working well — 2-3 items, each tied to a number from the data.
3. Priority changes — 2-3 items, ranked by impact. For each: the observation, why it matters physiologically, and a concrete change (specific foods, specific amounts).
4. One practical adjustment that fits the eating patterns visible in the log — not a generic meal plan.
5. What to expect over 2-4 weeks if the changes are made, with honest uncertainty.

Direct, warm, no hedging or filler. Cite the client's own numbers throughout. Under 450 words. If the data is too sparse for a real analysis, say so and name what to log instead of inventing conclusions.`;

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