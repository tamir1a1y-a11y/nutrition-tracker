import { useState, useEffect, useRef } from "react";

const CLIENT_ID = "75845239598-5193irc2lijcb7tbvhca8cqsaa0m1mde.apps.googleusercontent.com";
const SHEET_ID = "1jG8XNPbuRtuC140rMaRo0NUvIXLDSEtS6Qi0rQGXFIg";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;
const TARGETS = { calories: 2800, protein: 180, carbs: 340, fat: 80, fiber: 30 };
const BATCH_EXPIRY_DAYS = 30;

const ACCENT = "#c8f135";
const BG = "#0c0c0c";
const CARD = "#151515";
const CARD2 = "#1c1c1c";
const BORDER = "#252525";
const TEXT = "#f0f0f0";
const MUTED = "#555";
const MUTED2 = "#888";

const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
};
const timeStr = () => {
  const d = new Date();
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
};

const daysSince = (dateStr) => {
  if (!dateStr) return 0;
  const then = new Date(dateStr + "T00:00:00");
  if (isNaN(then.getTime())) return 0;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
};

const normalizeDate = (v) => {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return dmy[3] + "-" + pad(dmy[2]) + "-" + pad(dmy[1]);
  const num = Number(s);
  if (!isNaN(num) && num > 20000 && num < 80000) {
    const ms = Date.UTC(1899, 11, 30) + Math.floor(num) * 86400000;
    const d = new Date(ms);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.getFullYear() + "-" + pad(parsed.getMonth() + 1) + "-" + pad(parsed.getDate());
  }
  return s;
};

const normalizeTime = (v) => {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (/^\d{1,2}:\d{2}/.test(s)) return s;
  const num = Number(s);
  if (!isNaN(num) && num >= 0 && num < 1) {
    const mins = Math.round(num * 24 * 60);
    return pad(Math.floor(mins / 60)) + ":" + pad(mins % 60);
  }
  return s;
};

const readPref = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch { return fallback; }
};
const writePref = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
};

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
    `${BASE}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
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
    `${BASE}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
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

const ensureSheetTab = async (token, title) => {
  const res = await fetch(`${BASE}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] })
  });
  return res.ok;
};

const parseRows = (data, keys) => {
  const rows = data.values || [];
  if (rows.length <= 1) return [];
  return rows.slice(1).map((row, i) => {
    const obj = { _row: i + 2 };
    keys.forEach((k, j) => { obj[k] = row[j] || ""; });
    if (obj.date !== undefined) obj.date = normalizeDate(obj.date);
    if (obj.time !== undefined) obj.time = normalizeTime(obj.time);
    return obj;
  });
};

const MEAL_KEYS = ["id","name","type","created","total","used","ingredients","calories","protein","carbs","fat","fiber"];
const MEAL_HEADERS = ["ID","Name","Type","Created","Servings total","Servings used","Ingredients","Calories","Protein","Carbs","Fat","Fiber"];

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
  const [meals, setMeals] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);

  const [logMode, setLogMode] = useState(() => readPref("logMode", "describe"));
  const [prepScreen, setPrepScreen] = useState("library");
  const [cart, setCart] = useState({});
  const [cartExtra, setCartExtra] = useState("");
  const [cartSaving, setCartSaving] = useState(false);
  const [cartErr, setCartErr] = useState("");

  const [input, setInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [parseErr, setParseErr] = useState("");
  const [saving, setSaving] = useState(false);

  const [mName, setMName] = useState("");
  const [mIngredients, setMIngredients] = useState("");
  const [mServings, setMServings] = useState("");
  const [mType, setMType] = useState("batch");
  const [mParsing, setMParsing] = useState(false);
  const [mParsed, setMParsed] = useState(null);
  const [mErr, setMErr] = useState("");
  const [mSaving, setMSaving] = useState(false);

  const [weightVal, setWeightVal] = useState("");
  const [weightSaving, setWeightSaving] = useState(false);

  const [wkType, setWkType] = useState("Strength");
  const [wkDur, setWkDur] = useState("");
  const [wkNotes, setWkNotes] = useState("");
  const [wkSaving, setWkSaving] = useState(false);
  const [wkSaved, setWkSaved] = useState(false);

  const [aiInsight, setAiInsight] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightErr, setInsightErr] = useState("");

  const changeMode = (m) => { setLogMode(m); writePref("logMode", m); };

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
      await initMealsTab(t);
      await loadAll(t);
    } catch (e) {
      setAuthError("Sheet init error: " + e.message);
    }
    setDataLoading(false);
  };

  const initMealsTab = async (t) => {
    try {
      const data = await sheetsGet(t, "Meals!A1:L1");
      const first = (data.values || [[]])[0] || [];
      if (first.length === 0) await sheetsUpdate(t, "Meals!A1", [MEAL_HEADERS]);
    } catch {
      await ensureSheetTab(t, "Meals");
      try { await sheetsUpdate(t, "Meals!A1", [MEAL_HEADERS]); } catch (e2) { console.warn(e2); }
    }
  };

  const loadAll = async (t) => {
    try {
      const [foodData, weightData, workoutData] = await Promise.all([
        sheetsGet(t, "Food Log!A:H"),
        sheetsGet(t, "Weight Log!A:B"),
        sheetsGet(t, "Workout Log!A:D"),
      ]);
      setFoodLog(parseRows(foodData, ["date","time","description","calories","protein","carbs","fat","fiber"]).filter(o => o.date));
      setWeightLog(parseRows(weightData, ["date","weight"]).filter(o => o.date));
      setWorkoutLog(parseRows(workoutData, ["date","type","duration","notes"]).filter(o => o.date));

      try {
        const mealData = await sheetsGet(t, "Meals!A:L");
        setMeals(parseRows(mealData, MEAL_KEYS).filter(o => o.id));
      } catch { setMeals([]); }
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

  const mealsAvailable = meals.filter(m => {
    if (m.type === "fixed") return true;
    const left = (parseInt(m.total) || 0) - (parseInt(m.used) || 0);
    return left > 0 && daysSince(normalizeDate(m.created)) <= BATCH_EXPIRY_DAYS;
  });
  const mealsRestockable = meals.filter(m => {
    if (m.type === "fixed") return false;
    const left = (parseInt(m.total) || 0) - (parseInt(m.used) || 0);
    return left <= 0 || daysSince(normalizeDate(m.created)) > BATCH_EXPIRY_DAYS;
  });

  const callParse = async (description) => {
    const res = await fetch("/api/parse-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    if (!data.totals) throw new Error("Unexpected response format");
    return data;
  };

  const parseFood = async () => {
    if (!input.trim()) return;
    setParsing(true); setParsed(null); setParseErr("");
    try { setParsed(await callParse(input)); }
    catch (err) { setParseErr(err.message); }
    setParsing(false);
  };

  const confirmFood = async () => {
    if (!parsed || !token) return;
    setSaving(true);
    try {
      const row = [today, timeStr(), input,
        parsed.totals.calories, parsed.totals.protein,
        parsed.totals.carbs, parsed.totals.fat, parsed.totals.fiber];
      await sheetsAppend(token, "Food Log!A:H", [row]);
      await loadAll(token);
      setInput(""); setParsed(null);
    } catch (e) {
      setParseErr("Error saving to Sheets: " + e.message);
    }
    setSaving(false);
  };

  const parseMeal = async () => {
    const n = parseInt(mServings);
    if (!mIngredients.trim()) { setMErr("Add the ingredients first."); return; }
    if (!n || n < 1) { setMErr("Servings must be a whole number, 1 or more."); return; }
    setMParsing(true); setMParsed(null); setMErr("");
    try {
      const data = await callParse(mIngredients);
      const t = data.totals;
      setMParsed({
        items: data.items,
        totals: t,
        per: {
          calories: Math.round(t.calories / n),
          protein: Math.round((t.protein / n) * 10) / 10,
          carbs: Math.round((t.carbs / n) * 10) / 10,
          fat: Math.round((t.fat / n) * 10) / 10,
          fiber: Math.round((t.fiber / n) * 10) / 10,
        }
      });
    } catch (err) { setMErr(err.message); }
    setMParsing(false);
  };

  const saveMeal = async () => {
    if (!mParsed || !token) return;
    if (!mName.trim()) { setMErr("Give it a name."); return; }
    setMSaving(true);
    try {
      const n = parseInt(mServings);
      const p = mParsed.per;
      await sheetsAppend(token, "Meals!A:L", [[
        "m" + Date.now(), mName.trim(), mType, today, n, 0, mIngredients.trim(),
        p.calories, p.protein, p.carbs, p.fat, p.fiber
      ]]);
      await loadAll(token);
      setMName(""); setMIngredients(""); setMServings(""); setMParsed(null); setMErr("");
      setPrepScreen("library");
    } catch (e) { setMErr("Error saving: " + e.message); }
    setMSaving(false);
  };

  const cartAdd = (m) => {
    const cur = cart[m.id] || 0;
    if (m.type === "batch") {
      const left = (parseInt(m.total) || 0) - (parseInt(m.used) || 0);
      if (cur >= left) return;
    }
    setCart({ ...cart, [m.id]: cur + 1 });
  };

  const cartRemove = (m) => {
    const cur = cart[m.id] || 0;
    const next = { ...cart };
    if (cur <= 1) delete next[m.id]; else next[m.id] = cur - 1;
    setCart(next);
  };

  const cartPicked = meals.filter(m => (cart[m.id] || 0) > 0);
  const cartTotals = cartPicked.reduce((a, m) => {
    const q = cart[m.id];
    return {
      calories: a.calories + (parseFloat(m.calories) || 0) * q,
      protein: a.protein + (parseFloat(m.protein) || 0) * q,
      carbs: a.carbs + (parseFloat(m.carbs) || 0) * q,
      fat: a.fat + (parseFloat(m.fat) || 0) * q,
      fiber: a.fiber + (parseFloat(m.fiber) || 0) * q,
    };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

  const logCart = async () => {
    if (!token) return;
    const extra = cartExtra.trim();
    if (cartPicked.length === 0 && !extra) return;
    setCartSaving(true); setCartErr("");
    try {
      let t = { ...cartTotals };
      let parts = cartPicked.map(m => m.name + (cart[m.id] > 1 ? " x" + cart[m.id] : ""));

      if (extra) {
        const data = await callParse(extra);
        t.calories += parseFloat(data.totals.calories) || 0;
        t.protein += parseFloat(data.totals.protein) || 0;
        t.carbs += parseFloat(data.totals.carbs) || 0;
        t.fat += parseFloat(data.totals.fat) || 0;
        t.fiber += parseFloat(data.totals.fiber) || 0;
        parts.push("+ " + extra);
      }

      const r1 = (n) => Math.round(n * 10) / 10;
      await sheetsAppend(token, "Food Log!A:H", [[
        today, timeStr(), parts.join(", "),
        Math.round(t.calories), r1(t.protein), r1(t.carbs), r1(t.fat), r1(t.fiber)
      ]]);

      for (const m of cartPicked) {
        if (m.type !== "batch") continue;
        const newUsed = (parseInt(m.used) || 0) + cart[m.id];
        await sheetsUpdate(token, "Meals!F" + m._row, [[newUsed]]);
      }

      await loadAll(token);
      setCart({}); setCartExtra("");
    } catch (e) {
      setCartErr(e.message);
    }
    setCartSaving(false);
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
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
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

  const inputStyle = {
    width: "100%", boxSizing: "border-box", background: BG, border: `1px solid ${BORDER}`,
    borderRadius: 9, color: TEXT, padding: "11px 13px", fontSize: 14, outline: "none", fontFamily: "inherit"
  };
  const labelStyle = { fontSize: 10, color: MUTED2, display: "block", marginBottom: 5 };

  if (authStatus !== "connected") {
    return (
      <div style={{ background: BG, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Outfit', 'Segoe UI', sans-serif" }}>
        <div style={{ maxWidth: 340, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🥗</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: TEXT, marginBottom: 6, letterSpacing: -0.5 }}>
            Tamir <span style={{ color: ACCENT }}>·</span> Tracker
          </div>
          <div style={{ fontSize: 12, color: MUTED2, marginBottom: 32, lineHeight: 1.7 }}>
            Logs directly to your <strong style={{ color: TEXT }}>Google Sheet</strong> on Drive.
          </div>
          {authError && (
            <div style={{ background: "#ef444412", border: "1px solid #ef444430", borderRadius: 12, padding: "14px 16px", marginBottom: 20, fontSize: 12, color: "#ef4444", textAlign: "left", lineHeight: 1.7 }}>
              <strong>Error:</strong> {authError}
            </div>
          )}
          <button onClick={connect} disabled={!gisReady || authStatus === "loading"} style={{
            width: "100%", padding: "16px", background: !gisReady ? CARD2 : ACCENT,
            color: !gisReady ? MUTED : "#000", border: "none", borderRadius: 12,
            fontWeight: 800, fontSize: 14, cursor: !gisReady || authStatus === "loading" ? "not-allowed" : "pointer",
            letterSpacing: 0.3, fontFamily: "inherit"
          }}>
            {authStatus === "loading" ? "Opening Google sign-in..." : !gisReady ? "Loading..." : "Connect to Google Sheets →"}
          </button>
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
            <div style={{ display: "flex", background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 3, marginBottom: 14 }}>
              {[{ id: "describe", label: "Describe" }, { id: "prep", label: "From prep" }].map(m => (
                <button key={m.id} onClick={() => changeMode(m.id)} style={{
                  flex: 1, padding: "8px 0", border: "none", borderRadius: 7, cursor: "pointer",
                  background: logMode === m.id ? ACCENT : "transparent",
                  color: logMode === m.id ? "#000" : MUTED2,
                  fontSize: 12, fontWeight: 700, fontFamily: "inherit"
                }}>{m.label}</button>
              ))}
            </div>

            {logMode === "describe" && (
              <div>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={"Describe what you ate.\n\ne.g. Breakfast: 3 eggs scrambled, 2 slices sourdough"}
                  rows={5}
                  style={{ ...inputStyle, background: CARD, borderRadius: 12, padding: "13px 14px", resize: "none", lineHeight: 1.6, marginBottom: 10 }}
                />
                <button onClick={parseFood} disabled={parsing || !input.trim()} style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: parsing || !input.trim() ? CARD2 : ACCENT,
                  color: parsing || !input.trim() ? MUTED : "#000",
                  fontWeight: 800, fontSize: 13, cursor: parsing || !input.trim() ? "not-allowed" : "pointer", marginBottom: 12, fontFamily: "inherit"
                }}>
                  {parsing ? "Analyzing nutrition..." : "⟶ Calculate Macros"}
                </button>

                {parseErr && (
                  <div style={{ background: "#ef444410", border: "1px solid #ef444440", borderRadius: 10, padding: "13px 16px", marginBottom: 12, fontSize: 12, color: "#ef4444", lineHeight: 1.7 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ Something went wrong</div>
                    <div style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>{parseErr}</div>
                  </div>
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
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                      <button onClick={confirmFood} disabled={saving} style={{
                        flex: 1, padding: "11px", background: saving ? CARD2 : ACCENT,
                        color: saving ? MUTED : "#000", border: "none", borderRadius: 9,
                        fontWeight: 800, cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontFamily: "inherit"
                      }}>{saving ? "Saving..." : "✓ Save to Google Sheets"}</button>
                      <button onClick={() => { setParsed(null); setParseErr(""); }} style={{ padding: "11px 16px", background: "transparent", color: MUTED2, border: `1px solid ${BORDER}`, borderRadius: 9, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>✕</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {logMode === "prep" && prepScreen === "library" && (
              <div>
                {mealsAvailable.filter(m => m.type === "fixed").length > 0 && (
                  <>
                    <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Always available</div>
                    {mealsAvailable.filter(m => m.type === "fixed").map(m => (
                      <MealRow key={m.id} m={m} qty={cart[m.id] || 0} onAdd={() => cartAdd(m)} onRemove={() => cartRemove(m)} />
                    ))}
                  </>
                )}

                {mealsAvailable.filter(m => m.type === "batch").length > 0 && (
                  <>
                    <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", margin: "16px 0 8px" }}>Batches</div>
                    {mealsAvailable.filter(m => m.type === "batch").map(m => (
                      <MealRow key={m.id} m={m} qty={cart[m.id] || 0} onAdd={() => cartAdd(m)} onRemove={() => cartRemove(m)} />
                    ))}
                  </>
                )}

                {mealsAvailable.length === 0 && (
                  <div style={{ textAlign: "center", color: MUTED, fontSize: 13, padding: "30px 16px", border: `1px dashed ${BORDER}`, borderRadius: 12, lineHeight: 1.7 }}>
                    No prepped meals yet.<br />Create one below.
                  </div>
                )}

                <div style={{ marginTop: 18, border: `1px solid ${cartPicked.length || cartExtra.trim() ? "#3d4a22" : BORDER}`, background: cartPicked.length || cartExtra.trim() ? "#14170c" : CARD, borderRadius: 12, padding: "13px 14px" }}>
                  <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>This meal</div>

                  {cartPicked.length === 0 ? (
                    <div style={{ fontSize: 12, color: MUTED, padding: "4px 0" }}>Tap Add above to build a meal.</div>
                  ) : cartPicked.map(m => (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: TEXT, padding: "4px 0" }}>
                      <span>{m.name}{cart[m.id] > 1 ? " x" + cart[m.id] : ""}</span>
                      <span style={{ fontFamily: "monospace", color: MUTED2 }}>{Math.round((parseFloat(m.calories) || 0) * cart[m.id])}</span>
                    </div>
                  ))}

                  <input value={cartExtra} onChange={e => setCartExtra(e.target.value)}
                    placeholder="anything not saved — e.g. a banana"
                    style={{ ...inputStyle, fontSize: 12, padding: "9px 11px", margin: "10px 0 11px" }} />

                  <div style={{ display: "flex", gap: 9, fontSize: 12, fontFamily: "monospace", paddingTop: 10, borderTop: `1px solid ${BORDER}`, marginBottom: 11, flexWrap: "wrap" }}>
                    <span style={{ color: ACCENT }}>{Math.round(cartTotals.calories)} kcal</span>
                    <span style={{ color: "#4ade80" }}>P {Math.round(cartTotals.protein)}</span>
                    <span style={{ color: "#60a5fa" }}>C {Math.round(cartTotals.carbs)}</span>
                    <span style={{ color: "#fb923c" }}>F {Math.round(cartTotals.fat)}</span>
                    {cartExtra.trim() && <span style={{ color: MUTED, marginLeft: "auto" }}>+ text</span>}
                  </div>

                  {cartErr && (
                    <div style={{ background: "#ef444410", border: "1px solid #ef444440", borderRadius: 9, padding: "10px 12px", marginBottom: 10, fontSize: 11, color: "#ef4444", lineHeight: 1.6 }}>
                      {cartErr}
                    </div>
                  )}

                  <button onClick={logCart} disabled={cartSaving || (cartPicked.length === 0 && !cartExtra.trim())} style={{
                    width: "100%", padding: "11px", borderRadius: 9, border: "none", fontFamily: "inherit",
                    background: cartSaving || (cartPicked.length === 0 && !cartExtra.trim()) ? CARD2 : ACCENT,
                    color: cartSaving || (cartPicked.length === 0 && !cartExtra.trim()) ? MUTED : "#000",
                    fontWeight: 800, fontSize: 13,
                    cursor: cartSaving || (cartPicked.length === 0 && !cartExtra.trim()) ? "not-allowed" : "pointer"
                  }}>
                    {cartSaving ? "Saving..." : cartPicked.length ? "Log meal · " + Math.round(cartTotals.calories) + " kcal" : "Log meal"}
                  </button>
                </div>

                <button onClick={() => { setPrepScreen("create"); setMErr(""); }} style={{
                  width: "100%", marginTop: 12, padding: "12px", background: "transparent",
                  border: `1px dashed ${BORDER}`, borderRadius: 10, color: MUTED2,
                  fontSize: 12, cursor: "pointer", fontFamily: "inherit"
                }}>+ New prepped meal</button>
              </div>
            )}

            {logMode === "prep" && prepScreen === "create" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase" }}>New prepped meal</div>
                  <button onClick={() => { setPrepScreen("library"); setMParsed(null); setMErr(""); }}
                    style={{ background: "transparent", border: "none", color: MUTED2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Name</label>
                  <input value={mName} onChange={e => setMName(e.target.value)}
                    placeholder="Chicken + roast veg" style={inputStyle} />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Everything you made</label>
                  <textarea value={mIngredients} onChange={e => setMIngredients(e.target.value)}
                    rows={4}
                    placeholder={"1.5kg chicken thighs\n800g roasted vegetables\n3 tbsp olive oil"}
                    style={{ ...inputStyle, resize: "none", lineHeight: 1.6 }} />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Divided into how many portions</label>
                  <input type="number" min="1" step="1" value={mServings}
                    onChange={e => setMServings(e.target.value)}
                    placeholder="5" style={{ ...inputStyle, fontFamily: "monospace", fontSize: 17 }} />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Type</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {[
                      { id: "batch", label: "Batch", sub: "runs out" },
                      { id: "fixed", label: "Fixed", sub: "always there" }
                    ].map(t => (
                      <button key={t.id} onClick={() => setMType(t.id)} style={{
                        flex: 1, padding: "10px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                        border: `1px solid ${mType === t.id ? ACCENT : BORDER}`,
                        background: mType === t.id ? `${ACCENT}18` : "transparent",
                        color: mType === t.id ? ACCENT : MUTED2
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{t.label}</div>
                        <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{t.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={parseMeal} disabled={mParsing} style={{
                  width: "100%", padding: "13px", borderRadius: 10, border: "none",
                  background: mParsing ? CARD2 : ACCENT, color: mParsing ? MUTED : "#000",
                  fontWeight: 800, fontSize: 13, cursor: mParsing ? "not-allowed" : "pointer", fontFamily: "inherit"
                }}>{mParsing ? "Calculating..." : "⟶ Calculate per portion"}</button>

                {mErr && (
                  <div style={{ background: "#ef444410", border: "1px solid #ef444440", borderRadius: 10, padding: "12px 14px", marginTop: 12, fontSize: 12, color: "#ef4444", lineHeight: 1.6 }}>
                    {mErr}
                  </div>
                )}

                {mParsed && (
                  <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginTop: 14 }}>
                    <div style={{ fontSize: 9, color: MUTED2, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
                      Whole batch
                    </div>
                    <div style={{ display: "flex", gap: 9, fontSize: 11, fontFamily: "monospace", color: MUTED2, marginBottom: 14 }}>
                      <span>{mParsed.totals.calories} kcal</span>
                      <span>P {mParsed.totals.protein}</span>
                      <span>C {mParsed.totals.carbs}</span>
                      <span>F {mParsed.totals.fat}</span>
                    </div>

                    <div style={{ fontSize: 9, color: MUTED2, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
                      Per portion · 1 of {mServings}
                    </div>
                    <div style={{ display: "flex", gap: 10, fontSize: 13, fontFamily: "monospace", fontWeight: 700 }}>
                      <span style={{ color: ACCENT }}>{mParsed.per.calories} kcal</span>
                      <span style={{ color: "#4ade80" }}>P {mParsed.per.protein}</span>
                      <span style={{ color: "#60a5fa" }}>C {mParsed.per.carbs}</span>
                      <span style={{ color: "#fb923c" }}>F {mParsed.per.fat}</span>
                    </div>

                    <button onClick={saveMeal} disabled={mSaving} style={{
                      width: "100%", marginTop: 16, padding: "12px", borderRadius: 9, border: "none",
                      background: mSaving ? CARD2 : ACCENT, color: mSaving ? MUTED : "#000",
                      fontWeight: 800, fontSize: 13, cursor: mSaving ? "not-allowed" : "pointer", fontFamily: "inherit"
                    }}>{mSaving ? "Saving..." : "✓ Save to library"}</button>
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
                Today's Log — {todayFood.length} {todayFood.length === 1 ? "entry" : "entries"}
              </div>
              {todayFood.length === 0 ? (
                <div style={{ textAlign: "center", color: MUTED, fontSize: 13, padding: "30px 0", border: `1px dashed ${BORDER}`, borderRadius: 12 }}>
                  Nothing logged yet.
                </div>
              ) : (
                todayFood.map((e, i) => (
                  <div key={i} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 11, padding: "11px 14px", marginBottom: 8 }}>
                    <div style={{ fontSize: 9, color: MUTED, marginBottom: 3 }}>{e.time}</div>
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
                    <div style={{ height: "100%", width: `${Math.min((m.val / m.target) * 100, 100)}%`, background: m.val > m.target ? "#ef4444" : m.color, borderRadius: 2 }} />
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
                  style={{ ...inputStyle, flex: 1, fontSize: 20, fontFamily: "monospace", fontWeight: 700 }} />
                <span style={{ color: MUTED2, fontSize: 14, fontWeight: 600 }}>kg</span>
                <button onClick={logWeight} disabled={weightSaving || !weightVal} style={{
                  padding: "13px 20px", background: weightSaving ? CARD2 : ACCENT,
                  color: weightSaving ? MUTED : "#000", border: "none", borderRadius: 10, fontWeight: 800, cursor: "pointer", fontSize: 13, fontFamily: "inherit"
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
                    color: wkType === t ? ACCENT : MUTED2, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit"
                  }}>{t}</button>
                ))}
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Duration (minutes)</label>
                <input type="number" placeholder="60" value={wkDur} onChange={e => setWkDur(e.target.value)}
                  style={{ ...inputStyle, fontSize: 18, fontFamily: "monospace", fontWeight: 700 }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Notes (optional)</label>
                <input placeholder="e.g. Heavy squats, bench 3x5" value={wkNotes} onChange={e => setWkNotes(e.target.value)}
                  style={{ ...inputStyle, fontSize: 13 }} />
              </div>
              <button onClick={logWorkout} disabled={!wkDur || wkSaving} style={{
                width: "100%", padding: "13px", background: wkSaved ? "#4ade80" : wkDur ? ACCENT : CARD2,
                color: wkDur ? "#000" : MUTED, border: "none", borderRadius: 10, fontWeight: 800,
                cursor: wkDur ? "pointer" : "not-allowed", fontSize: 13, fontFamily: "inherit"
              }}>{wkSaving ? "Saving..." : wkSaved ? "✓ Logged!" : "Log Workout"}</button>
            </div>

            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase" }}>Weekly Goal</div>
                <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 16, color: ACCENT }}>{wkWorkouts} / 4</div>
              </div>
              <div style={{ height: 6, background: BORDER, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min((wkWorkouts / 4) * 100, 100)}%`, background: ACCENT, borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 11, color: MUTED2, marginTop: 8 }}>
                {wkWorkouts >= 4 ? "Weekly target hit." : `${4 - wkWorkouts} more session${4 - wkWorkouts !== 1 ? "s" : ""} to hit your target`}
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
              <div style={{ fontSize: 9, color: MUTED, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>AI Coach</div>
              <div style={{ fontSize: 12, color: MUTED2, marginBottom: 14, lineHeight: 1.7 }}>
                Get a personalized analysis of your last 14 days.
              </div>
              <button onClick={async () => {
                setInsightLoading(true); setInsightErr(""); setAiInsight("");
                try {
                  const res = await fetch("/api/insights", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ foodLog, weightLog, workoutLog, targets: TARGETS })
                  });
                  const data = await res.json();
                  if (!res.ok) { setInsightErr(data.error || "Failed"); }
                  else { setAiInsight(data.analysis); }
                } catch (e) { setInsightErr("Network error: " + e.message); }
                setInsightLoading(false);
              }} disabled={insightLoading} style={{
                width: "100%", padding: "13px", background: insightLoading ? CARD2 : ACCENT,
                color: insightLoading ? MUTED : "#000", border: "none", borderRadius: 10,
                fontWeight: 800, fontSize: 13, cursor: insightLoading ? "not-allowed" : "pointer", marginBottom: 12, fontFamily: "inherit"
              }}>
                {insightLoading ? "Analyzing your data..." : "⟶ Get AI Coaching Report"}
              </button>
              {insightErr && (
                <div style={{ background: "#ef444412", border: "1px solid #ef444430", borderRadius: 9, padding: "11px 13px", fontSize: 12, color: "#ef4444" }}>{insightErr}</div>
              )}
              {aiInsight && (
                <div style={{ background: BG, borderRadius: 10, padding: "14px 16px", fontSize: 13, color: TEXT, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{aiInsight}</div>
              )}
            </div>

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
                    <div style={{ height: 32, borderRadius: 5, background: d.logged && d.workouts > 0 ? ACCENT : d.logged ? `${ACCENT}55` : BORDER }} />
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
                  {avgCal >= TARGETS.calories * 0.92 && avgCal <= TARGETS.calories * 1.06 && avgPro >= TARGETS.protein * 0.9 && (
                    <div style={{ background: `${ACCENT}12`, border: `1px solid ${ACCENT}30`, borderRadius: 9, padding: "11px 13px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: ACCENT, marginBottom: 3 }}>On track</div>
                      <div style={{ fontSize: 12, color: MUTED2 }}>Calories and protein both on target.</div>
                    </div>
                  )}
                  {avgCal < TARGETS.calories * 0.85 && (
                    <div style={{ background: "#ef444412", border: "1px solid #ef444430", borderRadius: 9, padding: "11px 13px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginBottom: 3 }}>Too far below target</div>
                      <div style={{ fontSize: 12, color: MUTED2 }}>Averaging {fmt(TARGETS.calories - avgCal)} kcal below target.</div>
                    </div>
                  )}
                  {avgPro < TARGETS.protein * 0.85 && (
                    <div style={{ background: "#f59e0b12", border: "1px solid #f59e0b30", borderRadius: 9, padding: "11px 13px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", marginBottom: 3 }}>Protein too low</div>
                      <div style={{ fontSize: 12, color: MUTED2 }}>Avg {fmt(avgPro)}g vs {TARGETS.protein}g target.</div>
                    </div>
                  )}
                  {wkWorkouts < 3 && daysLogged >= 4 && (
                    <div style={{ background: "#60a5fa12", border: "1px solid #60a5fa30", borderRadius: 9, padding: "11px 13px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#60a5fa", marginBottom: 3 }}>Low workout frequency</div>
                      <div style={{ fontSize: 12, color: MUTED2 }}>Only {wkWorkouts} session(s) this week.</div>
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MealRow({ m, qty = 0, onAdd, onRemove }) {
  const isBatch = m.type === "batch";
  const left = (parseInt(m.total) || 0) - (parseInt(m.used) || 0);
  const atCap = isBatch && qty >= left;
  const btn = {
    width: 28, height: 28, padding: 0, background: CARD2, border: `1px solid ${BORDER}`,
    borderRadius: 7, color: TEXT, fontSize: 15, lineHeight: 1, cursor: "pointer", fontFamily: "inherit"
  };
  return (
    <div style={{ background: CARD, border: `1px solid ${qty > 0 ? "#3d4a22" : BORDER}`, borderRadius: 10, padding: "11px 13px", marginBottom: 7, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{m.name}</span>
          {isBatch ? (
            <span style={{ fontSize: 10, color: ACCENT, background: `${ACCENT}15`, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>
              {left} of {m.total}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: MUTED }}>∞</span>
          )}
        </div>
        <div style={{ fontSize: 11, fontFamily: "monospace", color: MUTED2, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: ACCENT }}>{m.calories} kcal</span>
          <span style={{ color: "#4ade80" }}>P {m.protein}</span>
          <span style={{ color: "#60a5fa" }}>C {m.carbs}</span>
          <span style={{ color: "#fb923c" }}>F {m.fat}</span>
        </div>
        <div style={{ fontSize: 10, color: MUTED, marginTop: 3 }}>
          1 of {m.total}{isBatch ? " · made " + normalizeDate(m.created) : " · recipe"}
        </div>
      </div>

      {qty > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button onClick={onRemove} style={btn}>−</button>
          <span style={{ fontFamily: "monospace", fontSize: 13, color: ACCENT, minWidth: 12, textAlign: "center" }}>{qty}</span>
          <button onClick={onAdd} disabled={atCap} style={{ ...btn, color: atCap ? MUTED : TEXT, cursor: atCap ? "not-allowed" : "pointer" }}>+</button>
        </div>
      ) : (
        <button onClick={onAdd} style={{
          padding: "7px 14px", background: "transparent", border: `1px solid #333`,
          borderRadius: 7, color: ACCENT, fontSize: 12, cursor: "pointer", flexShrink: 0, fontFamily: "inherit"
        }}>Add</button>
      )}
    </div>
  );
}