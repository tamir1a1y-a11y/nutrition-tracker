import { useState, useEffect, useRef } from "react";

const CLIENT_ID = "75845239598-5193irc2lijcb7tbvhca8cqsaa0m1mde.apps.googleusercontent.com";
const SHEET_ID = "1jG8XNPbuRtuC140rMaRo0NUvIXLDSEtS6Qi0rQGXFIg";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;
const TARGETS = { calories: 2800, protein: 180, carbs: 340, fat: 80, fiber: 30 };

const ACCENT = "#c8f135";
const BG = "#0c0c0c";
const CARD = "#151515";
const CARD2 = "#1c1c1c";
const BORDER = "#252525";
const TEXT = "#f0f0f0";
const MUTED = "#555";
const MUTED2 = "#888";

const todayStr = () => new Date().toISOString().split("T")[0];
const timeStr = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const fmt = (n) => Math.round(n);
const sum = (arr, key) => arr.reduce((a, e) => a + (parseFloat(e[key]) || 0), 0);

const sheetsGet = async (token, range) => {
  const res = await fetch(`${BASE}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Sheets read error");
  return data;
};

const sheetsAppend = async (token, range, values) => {
  const res = await fetch(
    `${BASE}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values })
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Sheets append error");
  return data;
};

const sheetsUpdate = async (token, range, values) => {
  const res = await fetch(
    `${BASE}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values })
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Sheets update error");
  return data;
};

const parseRows = (data, keys) => {
  const rows = data.values || [];
  if (rows.length <= 1) return [];
  return rows.slice(1).map(row => {
    const obj = {};
    keys.forEach((k, j) => { obj[k] = row[j] || ""; });
    return obj;
  });
};

export default function NutritionTracker() {
  const [tab, setTab] = useState("log");
  const [token, setToken] = useState(null);
  const [authStatus, setAuthStatus] = useState("idle");
  const [authError, setAuthError] = useState("");
  const [gisReady, setGisReady] = useState(false);
  const tokenClientRef = useRef(null);

  const [foodLog, setFoodLog] = useState([]);
  const [weightLog, setWeightLog] = useState([]);
  const [workoutLog, setWorkoutLog] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);

  const [input, setInput] = useState("");
  const [mealType, setMealType] = useState("Meal");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [parseErr, setParseErr] = useState("");
  const [saving, setSaving] = useState(false);

  const [weightVal, setWeightVal] = useState("");
  const [weightSaving, setWeightSaving] = useState(false);

  const [wkType, setWkType] = useState("Strength");
  const [wkDur, setWkDur] = useState("");
  const [wkNotes, setWkNotes] = useState("");
  const [wkSaving, setWkSaving] = useState(false);
  const [wkSaved, setWkSaved] = useState(false);

  useEffect(() => {
    if (window.google?.accounts?.oauth2) { setGisReady(true); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => setGisReady(true);
    script.onerror = () => setAuthError("Failed to load Google auth library.");
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!gisReady) return;
    tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: async (resp) => {
        if (resp.error) {
          setAuthError(resp.error_description || resp.error);
          setAuthStatus("error");
          return;
        }
        setToken(resp.access_token);
        setAuthStatus("connected");
        await initAndLoad(resp.access_token);
      }
    });
  }, [gisReady]);

  const connect = () => {
    setAuthStatus("loading");
    setAuthError("");
    tokenClientRef.current?.requestAccessToken();
  };

  const initAndLoad = async (t) => {
    setDataLoading(true);
    try {
      await Promise.all([
        initHeaders(t, "Food Log", ["Date","Time","Meal Type","Description","Calories","Protein","Carbs","Fat","Fiber"]),
        initHeaders(t, "Weight Log", ["Date","Weight (kg)"]),
        initHeaders(t, "Workout Log", ["Date","Type","Duration (min)","Notes"]),
      ]);
      await loadAll(t);
    } catch (e) {
      setAuthError("Sheet init error: " + e.message);
    }
    setDataLoading(false);
  };

  const initHeaders = async (t, sheet, headers) => {
    try {
      const data = await sheetsGet(t, `${sheet}!A1:Z1`);
      const first = (data.values || [[]])[0] || [];
      if (first.length === 0) await sheetsUpdate(t, `${sheet}!A1`, [headers]);
    } catch (e) {
      console.warn(`initHeaders(${sheet}):`, e.message);
    }
  };

  const loadAll = async (t) => {
    try {
      const [foodData, weightData, workoutData] = await Promise.all([
        sheetsGet(t, "Food Log!A:I"),
        sheetsGet(t, "Weight Log!A:B"),
        sheetsGet(t, "Workout Log!A:D"),
      ]);
      setFoodLog(parseRows(foodData, ["date","time","mealType","description","calories","protein","carbs","fat","fiber"]));
      setWeightLog(parseRows(weightData, ["date","weight"]));
      setWorkoutLog(parseRows(workoutData, ["date","type","duration","notes"]));
    } catch (e) {
      console.error("loadAll:", e.message);
    }
  };

  const today = todayStr();
  const todayFood = foodLog.filter(e => e.date === today);
  const tot = {
    calories: sum(todayFood, "calories"),
    protein: sum(todayFood, "protein"),
    carbs: sum(todayFood, "carbs"),
    fat: sum(todayFood, "fat"),
    fiber: sum(todayFood, "fiber"),
  };
  const calPct = Math.min((tot.calories / TARGETS.calories) * 100, 100);
  const calLeft = Math.max(0, TARGETS.calories - fmt(tot.calories));

  const parseFood = async () => {
    if (!input.trim()) return;
    setParsing(true); setParsed(null); setParseErr("");
    try {
      const res = await fetch("/api/parse-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: input })
      });
      const data = await res.json();
      setParsed(data);
    } catch {
      setParseErr("Couldn't parse this — try adding quantities, e.g. '200g chicken breast'.");
    }
    setParsing(false);
  };

  const confirmFood = async () => {
    if (!parsed || !token) return;
    setSaving(true);
    try {
      const row = [today, timeStr(), mealType, input,
        parsed.totals.calories, parsed.totals.protein,
        parsed.totals.carbs, parsed.totals.fat, parsed.totals.fiber];
      await sheetsAppend(token, "Food Log!A:I", [row]);
      await loadAll(token);
      setInput(""); setParsed(null);
    } catch (e) {
      setParseErr("Error saving to Sheets: " + e.message);
    }
    setSaving(false);
  };

  const logWeight = async () => {
    if (!weightVal || !token) return;
    setWeightSaving(true);
    try {
      await sheetsAppend(token, "Weight Log!A:B", [[today, parseFloat(weightVal)]]);
      await loadAll(token);
      setWeightVal("");
    } catch (e) { console.error(e); }
    setWeightSaving(false);
  };

  const logWorkout = async () => {
    if (!wkDur || !token) return;
    setWkSaving(true);
    try {
      await sheetsAppend(token, "Workout Log!A:D", [[today, wkType, parseInt(wkDur), wkNotes]]);
      await loadAll(token);
      setWkDur(""); setWkNotes(""); setWkSaved(true);
      setTimeout(() => setWkSaved(false), 2000);
    } catch (e) { console.error(e); }
    setWkSaving(false);
  };

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split("T")[0];
  });
  const weeklyRows = last7.map(date => {
    const fe = foodLog.filter(e => e.date === date);
    const we = workoutLog.filter(e => e.date === date);
    return { date, calories: sum(fe, "calories"), protein: sum(fe, "protein"), logged: fe.length > 0, workouts: we.length };
  });
  const daysLogged = weeklyRows.filter(d => d.logged).length;
  const avgCal = daysLogged > 0 ? weeklyRows.filter(d => d.logged).reduce((a, d) => a + d.calories, 0) / daysLogged : 0;
  const avgPro = daysLogged > 0 ? weeklyRows.filter(d => d.logged).reduce((a, d) => a + d.protein, 0) / daysLogged : 0;
  const wkWorkouts = weeklyRows.reduce((a, d) => a + d.workouts, 0);

  const TABS = [
    { id: "log", icon: "⊕", label: "Log" },
    { id: "today", icon: "◎", label: "Today" },
    { id: "weight", icon: "↕", label: "Weight" },
    { id: "workouts", icon: "◈", label: "Train" },
    { id: "insights", icon: "◇", label: "Insights" },
  ];

  if (authStatus !== "connected") {
    return (
      <div style={{ background: BG, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Outfit', 'Segoe UI', sans-serif" }}>
        <div style={{ maxWidth: 340, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🥗</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: TEXT, marginBottom: 6, letterSpacing: -0.5 }}>
            Tamir <span style={{ color: ACCENT }}>·</span> Tracker
          </div>
          <div style={{ fontSize: 12, color: MUTED2, marginBottom: 8, lineHeight: 1.7 }}>
            Logs directly to your <strong style={{ color: TEXT }}>Google Sheet</strong> on Drive.<br />
            Nothing is stored locally.
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 32, fontFamily: "monospace" }}>
            Sheet: Nutrition Tracker · Scope: spreadsheets
          </div>

          {authError && (
            <div style={{ background: "#ef444412", border: "1px solid #ef444430", borderRadius: 12, padding: "14px 16px", marginBottom: 20, fontSize: 12, color: "#ef4444", textAlign: "left", lineHeight: 1.7 }}>
              <strong>Error:</strong> {authError}
              <div style={{ marginTop: 8, color: MUTED2, fontSize: 11 }}>
                Add this to authorized origins in Google Cloud:<br />
                <span style={{ fontFamily: "monospace", color: TEXT }}>{window.location.origin}</span>
              </div>
            </div>
          )}

          <button onClick={connect} disabled={!gisReady || authStatus === "loading"} style={{
            width: "100%", padding: "16px", background: !gisReady ? CARD2 : ACCENT,
            color: !gisReady ? MUTED : "#000", border: "none", borderRadius: 12,
            fontWeight: 800, fontSize: 14, cursor: !gisReady || authStatus === "loading" ? "not-allowed" : "pointer",
            letterSpacing: 0.3, transition: "all 0.2s", fontFamily: "inherit"
          }}>
            {authStatus === "loading" ? "Opening Google sign-in..." : !gisReady ? "Loading Google auth..." : "Connect to Google Sheets →"}
          </button>

          <div style={{ marginTop: 24, fontSize: 10, color: MUTED, lineHeight: 2 }}>
            <div>🔐 OAuth 2.0 — you authorize, we never store your token</div>
            <div>📊 Writes to: Food Log · Weight Log · Workout Log</div>
            <div>🎯 Goal: Recomp · 2,800 kcal · 180g protein</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", maxWidth: 460, margin: "0 auto", fontFamily: "'Outfit', 'Segoe UI', sans-serif", color: TEXT, paddingBottom: 48 }}>
      <div style={{ background: CARD, borderBottom: `1px solid ${BORDER}`, padding: "20px 20px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 10, color: MUTED2, letterSpacing: 3, textTransform: "uppercase", marginBottom: 3 }}>
              {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.5 }}>Tamir <span style={{ color: ACCENT }}>·</span> Tracker</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase" }}>today</div>
            <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: -1, fontFamily: "monospace", lineHeight: 1, color: tot.calories > TARGETS.calories ? "#ef4444" : ACCENT }}>
              {dataLoading ? "···" : fmt(tot.calories)}
            </div>
            <div style={{ fontSize: 9, color: MUTED2 }}>/ {TARGETS.calories.toLocaleString()} kcal</div>
          </div>
        </div>
        <div style={{ height: 3, background: BORDER, borderRadius: 2, overflow: "hidden", marginBottom: 1 }}>
          <div style={{ height: "100%", width: `${calPct}%`, background: tot.calories > TARGETS.calories ? "#ef4444" : ACCENT, borderRadius: 2, transition: "width 0.6s ease" }} />
        </div>
        <div style={{ display: "flex" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "12px 0 10px", border: "none", background: "transparent", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              borderBottom: tab === t.id ? `2px solid ${ACCENT}` : "2px solid transparent",
            }}>
              <span style={{ fontSize: 14, color: tab === t.id ? ACCENT : MUTED }}>{t.icon}</span>
              <span style={{ fontSize: 9, letterSpacing: 1, textTransform: "uppercase", fontWeight: tab === t.id ? 700 : 400, color: tab === t.id ? ACCENT : MUTED }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px 16px 0" }}>
        <div style={{ background: `${ACCENT}10`, border: `1px solid ${ACCENT}20`, borderRadius: 9, padding: "8px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: ACCENT, fontWeight: 600 }}>✓ Live · Google Sheets</span>
          <button onClick={() => { setDataLoading(true); loadAll(token).finally(() => setDataLoading(false)); }}
            style={{ fontSize: 10, color: MUTED2, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
            {dataLoading ? "syncing..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      <div style={{ padding: "0 16px" }}>

        {tab === "log" && (
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {["Breakfast", "Meal", "Snack", "Dinner"].map(t => (
                <button key={t} onClick={() => setMealType(t)} style={{
                  flex: 1, padding: "7px 0", border: `1px solid ${mealType === t ? ACCENT : BORDER}`,
                  borderRadius: 8, background: mealType === t ? `${ACCENT}18` : "transparent",
                  color: mealType === t ? ACCENT : MUTED2, cursor: "pointer", fontSize: 10, fontWeight: 700, transition: "all 0.15s"
                }}>{t}</button>
              ))}
            </div>
            <textarea value={input} onChange={e => setInput(e.target.value)}
              placeholder={"Describe what you ate...\ne.g. 200g chicken breast, 150g rice, salad with 10ml olive oil"}
              rows={3}
              style={{ width: "100%", boxSizing: "border-box", background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, color: TEXT, padding: "13px 14px", fontSize: 14, resize: "none", outline: "none", fontFamily: "inherit", lineHeight: 1.6, marginBottom: 10 }} />
            <button onClick={parseFood} disabled={parsing || !input.trim()} style={{
              width: "100%", padding: "14px", borderRadius: 12, border: "none",
              background: parsing || !input.trim() ? CARD2 : ACCENT,
              color: parsing || !input.trim() ? MUTED : "#000",
              fontWeight: 800, fontSize: 13, cursor: parsing || !input.trim() ? "not-allowed" : "pointer", marginBottom: 12, transition: "all 0.2s"
            }}>
              {parsing ? "Analyzing nutrition..." : "⟶ Calculate Macros"}
            </button>

            {parseErr && (
              <div style={{ background: "#ef444410", border: "1px solid #ef444430", borderRadius: 10, padding: "11px 14px", marginBottom: 12, fontSize: 12, color: "#ef4444" }}>{parseErr}</div>
            )}

            {parsed && (
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 9, color: MUTED2, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>Breakdown</div>
                {parsed.items.map((item, i) => (
                  <div key={i} style={{ padding: "9px 0", borderBottom: i < parsed.items.length - 1 ? `1px solid ${BORDER}` : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</span>
                      <span style={{ fontSize: 11, color: MUTED2 }}>{item.quantity}</span>
                    </div>
                    <div style={{ display: "flex", gap: 10, fontSize: 11, fontFamily: "monospace" }}>
                      <span style={{ color: ACCENT }}>{item.calories} kcal</span>
                      <span style={{ color: "#4ade80" }}>P {item.protein}g</span>
                      <span style={{ color: "#60a5fa" }}>C {item.carbs}g</span>
                      <span style={{ color: "#fb923c" }}>F {item.fat}g</span>
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 10, fontSize: 12, fontFamily: "monospace", fontWeight: 700, paddingTop: 10, borderTop: `1px solid ${BORDER}`, marginTop: 4 }}>
                  <span style={{ color: ACCENT }}>{parsed.totals.calories} kcal</span>
                  <span style={{ color: "#4ade80" }}>P {parsed.totals.protein}g</span>
                  <span style={{ color: "#60a5fa" }}>C {parsed.totals.carbs}g</span>
                  <span style={{ color: "#fb923c" }}>F {parsed.totals.fat}g</span>
                  <span style={{ color: "#c084fc" }}>Fi {parsed.totals.fiber}g</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button onClick={confirmFood} disabled={saving} style={{
                    flex: 1, padding: "11px", background: saving ? CARD2 : ACCENT,
                    color: saving ? MUTED : "#000", border: "none", borderRadius: 9,
                    fontWeight: 800, cursor: saving ? "not-allowed" : "pointer", fontSize: 13
                  }}>{saving ? "Saving to Sheets..." : "✓ Save to Google Sheets"}</button>
                  <button onClick={() => setParsed(null)} style={{ padding: "11px 16px", background: "transparent", color: MUTED2, border: `1px solid ${BORDER}`, borderRadius: 9, cursor: "pointer", fontSize: 13 }}>✕</button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
                Today's Log — {todayFood.length} {todayFood.length === 1 ? "entry" : "entries"}
              </div>
              {todayFood.length === 0 ? (
                <div style={{ textAlign: "center", color: MUTED, fontSize: 13, padding: "30px 0", border: `1px dashed ${BORDER}`, borderRadius: 12 }}>Nothing logged yet. Start above ↑</div>
              ) : (
                todayFood.map((e, i) => (
                  <div key={i} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 11, padding: "11px 14px", marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
                      <span style={{ fontSize: 9, color: ACCENT, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1 }}>{e.mealType}</span>
                      <span style={{ fontSize: 9, color: MUTED }}>{e.time}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.description}</div>
                    <div style={{ fontSize: 11, fontFamily: "monospace", display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ color: ACCENT }}>{fmt(e.calories)} kcal</span>
                      <span style={{ color: "#4ade80" }}>P {fmt(e.protein)}g</span>
                      <span style={{ color: "#60a5fa" }}>C {fmt(e.carbs)}g</span>
                      <span style={{ color: "#fb923c" }}>F {fmt(e.fat)}g</span>
                    </div>
                  </div>
                ))
              )}
              {todayFood.length > 0 && (
                <div style={{ background: CARD2, borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "monospace", fontWeight: 700, marginTop: 4 }}>
                  <span style={{ color: MUTED2 }}>TOTAL</span>
                  <span style={{ color: ACCENT }}>{fmt(tot.calories)}</span>
                  <span style={{ color: "#4ade80" }}>P{fmt(tot.protein)}g</span>
                  <span style={{ color: "#60a5fa" }}>C{fmt(tot.carbs)}g</span>
                  <span style={{ color: "#fb923c" }}>F{fmt(tot.fat)}g</span>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "today" && (
          <div>
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: "22px 20px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Calories Today</div>
                  <div style={{ fontSize: 46, fontWeight: 900, fontFamily: "monospace", letterSpacing: -2, lineHeight: 1, color: tot.calories > TARGETS.calories ? "#ef4444" : ACCENT }}>{fmt(tot.calories)}</div>
                  <div style={{ fontSize: 11, color: MUTED2, marginTop: 4 }}>of {TARGETS.calories.toLocaleString()} kcal target</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Remaining</div>
                  <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: TEXT }}>{calLeft}</div>
                  <div style={{ fontSize: 10, color: MUTED2 }}>kcal left</div>
                </div>
              </div>
              <div style={{ height: 6, background: BORDER, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${calPct}%`, background: tot.calories > TARGETS.calories ? "#ef4444" : ACCENT, borderRadius: 3, transition: "width 0.6s ease" }} />
              </div>
            </div>

            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: "20px 12px", marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 18 }}>Macros</div>
              <div style={{ display: "flex", justifyContent: "space-around" }}>
                {[
                  { label: "Protein", val: tot.protein, target: TARGETS.protein, color: "#4ade80" },
                  { label: "Carbs", val: tot.carbs, target: TARGETS.carbs, color: "#60a5fa" },
                  { label: "Fat", val: tot.fat, target: TARGETS.fat, color: "#fb923c" },
                  { label: "Fiber", val: tot.fiber, target: TARGETS.fiber, color: "#c084fc" },
                ].map(m => {
                  const pct = Math.min((m.val / m.target) * 100, 100);
                  const over = m.val > m.target;
                  const r = 26, circ = 2 * Math.PI * r, dash = (pct / 100) * circ;
                  return (
                    <div key={m.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                      <div style={{ position: "relative", width: 68, height: 68 }}>
                        <svg width="68" height="68" style={{ transform: "rotate(-90deg)" }}>
                          <circle cx="34" cy="34" r={r} fill="none" stroke={BORDER} strokeWidth="5" />
                          <circle cx="34" cy="34" r={r} fill="none" stroke={over ? "#ef4444" : m.color} strokeWidth="5"
                            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
                        </svg>
                        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: over ? "#ef4444" : TEXT }}>{fmt(m.val)}</span>
                          <span style={{ fontSize: 8, color: MUTED }}>/ {m.target}g</span>
                        </div>
                      </div>
                      <span style={{ fontSize: 9, color: MUTED2, textTransform: "uppercase", letterSpacing: 1 }}>{m.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>Breakdown</div>
              {[
                { label: "Protein", val: tot.protein, target: TARGETS.protein, color: "#4ade80" },
                { label: "Carbohydrates", val: tot.carbs, target: TARGETS.carbs, color: "#60a5fa" },
                { label: "Fat", val: tot.fat, target: TARGETS.fat, color: "#fb923c" },
                { label: "Fiber", val: tot.fiber, target: TARGETS.fiber, color: "#c084fc" },
              ].map(m => (
                <div key={m.label} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: MUTED2 }}>{m.label}</span>
                    <span style={{ fontSize: 12, fontFamily: "monospace", color: m.val > m.target ? "#ef4444" : TEXT, fontWeight: 600 }}>{fmt(m.val)} / {m.target}g</span>
                  </div>
                  <div style={{ height: 4, background: BORDER, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min((m.val / m.target) * 100, 100)}%`, background: m.val > m.target ? "#ef4444" : m.color, borderRadius: 2, transition: "width 0.6s ease" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "weight" && (
          <div>
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>Log Today's Weight</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="number" step="0.1" placeholder="110.0" value={weightVal}
                  onChange={e => setWeightVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") logWeight(); }}
                  style={{ flex: 1, background: BG, border: `1px solid ${BORDER}`, borderRadius: 10, color: TEXT, padding: "13px 14px", fontSize: 20, outline: "none", fontFamily: "monospace", fontWeight: 700 }} />
                <span style={{ color: MUTED2, fontSize: 14, fontWeight: 600 }}>kg</span>
                <button onClick={logWeight} disabled={weightSaving || !weightVal} style={{
                  padding: "13px 20px", background: weightSaving ? CARD2 : ACCENT,
                  color: weightSaving ? MUTED : "#000", border: "none", borderRadius: 10, fontWeight: 800, cursor: "pointer", fontSize: 13
                }}>{weightSaving ? "..." : "Log"}</button>
              </div>
            </div>

            {weightLog.length > 0 && (() => {
              const sorted = [...weightLog].sort((a, b) => a.date.localeCompare(b.date));
              const latest = sorted[sorted.length - 1];
              const prev = sorted[sorted.length - 2];
              const change = prev ? (parseFloat(latest.weight) - parseFloat(prev.weight)).toFixed(1) : null;
              const total = (parseFloat(latest.weight) - 110).toFixed(1);
              return (
                <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Current</div>
                    <div style={{ fontSize: 32, fontWeight: 900, fontFamily: "monospace" }}>{latest.weight}<span style={{ fontSize: 14, color: MUTED2, marginLeft: 3 }}>kg</span></div>
                  </div>
                  {change !== null && (
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Last change</div>
                      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: parseFloat(change) < 0 ? "#4ade80" : "#ef4444" }}>
                        {parseFloat(change) > 0 ? "+" : ""}{change}
                      </div>
                    </div>
                  )}
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>vs Start</div>
                    <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: parseFloat(total) < 0 ? "#4ade80" : "#ef4444" }}>
                      {parseFloat(total) > 0 ? "+" : ""}{total}
                    </div>
                  </div>
                </div>
              );
            })()}

            <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>History</div>
            {weightLog.length === 0 ? (
              <div style={{ textAlign: "center", color: MUTED, fontSize: 13, padding: "24px 0", border: `1px dashed ${BORDER}`, borderRadius: 12 }}>No weight logged yet.</div>
            ) : (
              [...weightLog].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map((e, i, arr) => {
                const next = arr[i + 1];
                const diff = next ? (parseFloat(e.weight) - parseFloat(next.weight)).toFixed(1) : null;
                return (
                  <div key={i} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "11px 16px", marginBottom: 7, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 10, color: MUTED2, marginBottom: 2 }}>{e.date}</div>
                      <div style={{ fontSize: 18, fontFamily: "monospace", fontWeight: 800 }}>{e.weight} kg</div>
                    </div>
                    {diff !== null && (
                      <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: parseFloat(diff) < 0 ? "#4ade80" : parseFloat(diff) > 0 ? "#ef4444" : MUTED }}>
                        {parseFloat(diff) > 0 ? "+" : ""}{diff} kg
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === "workouts" && (
          <div>
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>Log Workout</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                {["Strength", "Swimming", "Cardio", "Mobility", "Other"].map(t => (
                  <button key={t} onClick={() => setWkType(t)} style={{
                    padding: "7px 13px", border: `1px solid ${wkType === t ? ACCENT : BORDER}`,
                    borderRadius: 8, background: wkType === t ? `${ACCENT}18` : "transparent",
                    color: wkType === t ? ACCENT : MUTED2, cursor: "pointer", fontSize: 11, fontWeight: 700, transition: "all 0.15s"
                  }}>{t}</button>
                ))}
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10, color: MUTED2, display: "block", marginBottom: 5 }}>Duration (minutes)</label>
                <input type="number" placeholder="60" value={wkDur} onChange={e => setWkDur(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", background: BG, border: `1px solid ${BORDER}`, borderRadius: 9, color: TEXT, padding: "11px 13px", fontSize: 18, outline: "none", fontFamily: "monospace", fontWeight: 700 }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 10, color: MUTED2, display: "block", marginBottom: 5 }}>Notes (optional)</label>
                <input placeholder="e.g. Heavy squats, bench 3×5" value={wkNotes} onChange={e => setWkNotes(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", background: BG, border: `1px solid ${BORDER}`, borderRadius: 9, color: TEXT, padding: "11px 13px", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
              </div>
              <button onClick={logWorkout} disabled={!wkDur || wkSaving} style={{
                width: "100%", padding: "13px", background: wkSaved ? "#4ade80" : wkDur ? ACCENT : CARD2,
                color: wkDur ? "#000" : MUTED, border: "none", borderRadius: 10, fontWeight: 800,
                cursor: wkDur ? "pointer" : "not-allowed", fontSize: 13, transition: "all 0.3s"
              }}>{wkSaving ? "Saving to Sheets..." : wkSaved ? "✓ Logged!" : "Log Workout"}</button>
            </div>

            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase" }}>Weekly Goal</div>
                <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 16, color: ACCENT }}>{wkWorkouts} / 4</div>
              </div>
              <div style={{ height: 6, background: BORDER, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min((wkWorkouts / 4) * 100, 100)}%`, background: ACCENT, borderRadius: 3, transition: "width 0.5s" }} />
              </div>
              <div style={{ fontSize: 11, color: MUTED2, marginTop: 8 }}>
                {wkWorkouts >= 4 ? "✓ Weekly target hit! 💪" : `${4 - wkWorkouts} more session${4 - wkWorkouts !== 1 ? "s" : ""} to hit your target`}
              </div>
            </div>

            <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>History</div>
            {workoutLog.length === 0 ? (
              <div style={{ textAlign: "center", color: MUTED, fontSize: 13, padding: "24px 0", border: `1px dashed ${BORDER}`, borderRadius: 12 }}>No workouts logged yet.</div>
            ) : (
              [...workoutLog].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20).map((e, i) => (
                <div key={i} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "11px 16px", marginBottom: 7, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{e.type}</span>
                      <span style={{ fontSize: 10, color: MUTED2 }}>{e.date}</span>
                    </div>
                    {e.notes && <div style={{ fontSize: 11, color: MUTED2 }}>{e.notes}</div>}
                  </div>
                  <span style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: ACCENT }}>{e.duration}m</span>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "insights" && (
          <div>
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>7-Day Overview</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                {[
                  { label: "Avg Calories", val: daysLogged > 0 ? `${fmt(avgCal)}` : "—", unit: "kcal", color: ACCENT },
                  { label: "Avg Protein", val: daysLogged > 0 ? `${fmt(avgPro)}` : "—", unit: "g", color: "#4ade80" },
                  { label: "Days Logged", val: daysLogged, unit: "/ 7", color: "#60a5fa" },
                  { label: "Workouts", val: wkWorkouts, unit: "/ 4", color: "#fb923c" },
                ].map(s => (
                  <div key={s.label} style={{ background: BG, borderRadius: 10, padding: "14px" }}>
                    <div style={{ fontSize: 9, color: MUTED, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontFamily: "monospace", fontWeight: 800, color: s.color }}>
                      <span style={{ fontSize: 24 }}>{s.val}</span>
                      <span style={{ fontSize: 10, color: MUTED2, marginLeft: 4 }}>{s.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 9, color: MUTED, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Daily Streak</div>
              <div style={{ display: "flex", gap: 5 }}>
                {weeklyRows.map(d => (
                  <div key={d.date} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 8, color: MUTED2, marginBottom: 4 }}>
                      {new Date(d.date + "T12:00:00").toLocaleDateString("en", { weekday: "narrow" })}
                    </div>
                    <div style={{ height: 32, borderRadius: 5, background: d.logged && d.workouts > 0 ? ACCENT : d.logged ? `${ACCENT}55` : BORDER, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {d.workouts > 0 && <span style={{ fontSize: 11 }}>💪</span>}
                    </div>
                    <div style={{ fontSize: 8, color: MUTED, marginTop: 3 }}>{d.logged ? fmt(d.calories) : ""}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>Smart Flags</div>
              {daysLogged === 0 ? (
                <div style={{ fontSize: 13, color: MUTED2 }}>Log 2–3 days of meals to get personalized insights.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {avgCal < TARGETS.calories * 0.85 && (
                    <div style={{ background: "#ef444412", border: "1px solid #ef444430", borderRadius: 9, padding: "11px 13px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginBottom: 3 }}>⚠ Too Far Below Target</div>
                      <div style={{ fontSize: 12, color: MUTED2 }}>Averaging {fmt(TARGETS.calories - avgCal)} kcal below target. Too large a deficit risks muscle loss.</div>
                    </div>
                  )}
                  {avgCal > TARGETS.calories * 1.1 && (
                    <div style={{ background: "#ef444412", border: "1px solid #ef444430", borderRadius: 9, padding: "11px 13px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginBottom: 3 }}>⚠ Over Target</div>
                      <div style={{ fontSize: 12, color: MUTED2 }}>Averaging {fmt(avgCal - TARGETS.calories)} kcal over target. Reduce portions or cut a snack.</div>
                    </div>
                  )}
                  {avgPro < TARGETS.protein * 0.85 && (
                    <div style={{ background: "#f59e0b12", border: "1px solid #f59e0b30", borderRadius: 9, padding: "11px 13px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", marginBottom: 3 }}>⚠ Protein Too Low</div>
                      <div style={{ fontSize: 12, color: MUTED2 }}>Avg {fmt(avgPro)}g vs {TARGETS.protein}g target. Add chicken, eggs, tuna, or cottage cheese.</div>
                    </div>
                  )}
                  {wkWorkouts < 3 && daysLogged >= 4 && (
                    <div style={{ background: "#60a5fa12", border: "1px solid #60a5fa30", borderRadius: 9, padding: "11px 13px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#60a5fa", marginBottom: 3 }}>💡 Low Workout Frequency</div>
                      <div style={{ fontSize: 12, color: MUTED2 }}>Only {wkWorkouts} session(s) this week. 4/week is your recomp foundation.</div>
                    </div>
                  )}
                  {avgCal >= TARGETS.calories * 0.92 && avgCal <= TARGETS.calories * 1.06 && avgPro >= TARGETS.protein * 0.9 && (
                    <div style={{ background: `${ACCENT}12`, border: `1px solid ${ACCENT}30`, borderRadius: 9, padding: "11px 13px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: ACCENT, marginBottom: 3 }}>✓ On Track</div>
                      <div style={{ fontSize: 12, color: MUTED2 }}>Calories and protein both on target. Keep this up — results show in 4–6 weeks.</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>Your Daily Targets</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { label: "Calories", val: "2,800", unit: "kcal", c: ACCENT },
                  { label: "Protein", val: "180", unit: "g", c: "#4ade80" },
                  { label: "Carbs", val: "340", unit: "g", c: "#60a5fa" },
                  { label: "Fat", val: "80", unit: "g", c: "#fb923c" },
                  { label: "Fiber", val: "30", unit: "g", c: "#c084fc" },
                  { label: "TDEE", val: "3,300", unit: "kcal", c: MUTED2 },
                ].map(t => (
                  <div key={t.label} style={{ background: BG, borderRadius: 9, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: MUTED2 }}>{t.label}</span>
                    <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13, color: t.c }}>{t.val}<span style={{ fontSize: 9, color: MUTED, marginLeft: 2 }}>{t.unit}</span></span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14, padding: "12px 14px", background: BG, borderRadius: 10, fontSize: 11, color: MUTED2, lineHeight: 1.7 }}>
                <strong style={{ color: TEXT }}>Goal:</strong> Recomposition · 110kg → ~92kg at 14% BF<br />
                <strong style={{ color: ACCENT }}>Timeline: 9–14 months</strong> · ~500 kcal daily deficit
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}