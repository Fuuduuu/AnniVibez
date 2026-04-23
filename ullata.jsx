import { useState, useRef } from "react";

const WITH_OPTIONS = [
  { id: "endale", label: "Endale", emoji: "🌟" },
  { id: "issi", label: "Issiga", emoji: "🔧" },
  { id: "emme", label: "Emmega", emoji: "🌸" },
  { id: "vanaema", label: "Vanaemaga", emoji: "🧶" },
  { id: "loomadele", label: "Loomadele", emoji: "🐾" },
];

const MATERIAL_OPTIONS = [
  "Paber ja pliiatsid", "Värvid", "Käärid ja kleeplint",
  "Lõng / heegelnõel", "Vana riie / t-särk", "Karbikarps",
  "Kleepsud ja washi-teip", "Akvarellvärvid", "Felt-viltpliiatsid",
  "Ajalehed", "Köögitarbed", "Telefon / kaamera",
];

const TIME_OPTIONS = [
  { id: 10, label: "10 min", sub: "kiire" },
  { id: 20, label: "20 min", sub: "normaalne" },
  { id: 30, label: "30 min", sub: "rahulik" },
  { id: 60, label: "kauem", sub: "projekt" },
];

const MOOD_OPTIONS = [
  { id: "joonista", label: "joonista", emoji: "✏️" },
  { id: "meisterda", label: "meisterda", emoji: "✂️" },
  { id: "heegelda", label: "heegelda", emoji: "🧶" },
  { id: "küpseta", label: "küpseta", emoji: "🍪" },
  { id: "videoidee", label: "videoidee", emoji: "🎬" },
  { id: "armas", label: "armas", emoji: "🩷" },
  { id: "naljakas", label: "naljakas", emoji: "😂" },
  { id: "rahulik", label: "rahulik", emoji: "🌿" },
  { id: "maagiline", label: "maagiline", emoji: "✨" },
  { id: "kasulik", label: "kasulik", emoji: "💡" },
  { id: "mälestuseks", label: "mälestuseks", emoji: "📷" },
  { id: "üllatav", label: "üllatav", emoji: "🎁" },
];

const SYSTEM_PROMPT = `Sa oled loov nõustaja 10-13-aastasele väga loovale tüdrukule. Anna alati üks konkreetne, teostatav idee.

Vasta AINULT JSON-ina, ilma markdown-ita:
{
  "idea_title": "Lühike, äge pealkiri (max 6 sõna)",
  "what_to_do": "Täpsed sammud mida teha (2-3 lauset, konkreetne)",
  "why_it_fits": "Miks see just talle sobib (1 lause, soe toon)",
  "easy_start_tip": "Esimene samm mida KOHE teha saab (1 lause)",
  "new_tip_or_trick": "Üks uus oskus/nipp mida ta selle juures õpib (1 lause)",
  "make_it_yours": "Kuidas teha seda oma stiilis (1 lause, innustav)",
  "easier_version": "Lihtsamate vahenditega/lühema ajaga versioon (1 lause)"
}`;

function buildPrompt(form) {
  const mats = [...form.materials, form.customMaterial].filter(Boolean).join(", ") || "mis iganes käepärast on";
  return `Kellega: ${form.with}
Materjalid: ${mats}
Aega: ${form.time} minutit
Mood/stiil: ${form.mood.join(", ")}

Anna üks idee mis TÄPSELT sobib nendele tingimustele.`;
}

async function callClaude(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text ?? "";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  bg: "hsl(35,30%,97%)",
  card: "#fff",
  accent: "hsl(280,45%,58%)",    // lilla
  accentLight: "hsl(280,45%,95%)",
  green: "hsl(150,55%,38%)",
  greenLight: "hsl(150,55%,93%)",
  text: "hsl(260,15%,18%)",
  muted: "hsl(260,8%,52%)",
  border: "hsl(260,10%,88%)",
  pill: "hsl(35,20%,93%)",
  pillActive: "hsl(280,45%,58%)",
};

const pill = (active, small) => ({
  display: "inline-flex", alignItems: "center", gap: 5,
  padding: small ? "5px 12px" : "8px 16px",
  fontSize: small ? 13 : 14,
  borderRadius: 100,
  border: `1.5px solid ${active ? C.pillActive : C.border}`,
  background: active ? C.accentLight : C.pill,
  color: active ? C.accent : C.muted,
  cursor: "pointer", fontWeight: active ? 500 : 400,
  transition: "all .15s",
});

const card = {
  background: C.card, borderRadius: 20,
  border: `1px solid ${C.border}`,
  padding: "20px 20px", marginBottom: 12,
};

const stepLabel = (active, done) => ({
  width: 28, height: 28, borderRadius: "50%",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 13, fontWeight: 600, flexShrink: 0,
  background: done ? C.green : active ? C.accent : C.pill,
  color: done || active ? "#fff" : C.muted,
  transition: "all .2s",
});

// ── Stepper header ─────────────────────────────────────────────────────────
function Stepper({ step }) {
  const labels = ["Kellega?", "Materjalid", "Aeg", "Stiil"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 24, padding: "0 2px" }}>
      {labels.map((l, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, flex: i < 3 ? "1 1 0" : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={stepLabel(i === step, i < step)}>
              {i < step ? "✓" : i + 1}
            </div>
            {i === step && (
              <span style={{ fontSize: 13, fontWeight: 500, color: C.text, whiteSpace: "nowrap" }}>{l}</span>
            )}
          </div>
          {i < 3 && (
            <div style={{
              flex: 1, height: 1.5,
              background: i < step ? C.green : C.border,
              borderRadius: 2, transition: "background .3s",
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── IdeaCard ───────────────────────────────────────────────────────────────
function IdeaCard({ idea, onRetry, onSave, saved }) {
  const fields = [
    { key: "what_to_do",       label: "Mida teha",         emoji: "📋", bg: "#f8f6ff" },
    { key: "easy_start_tip",   label: "Alusta kohe",        emoji: "⚡", bg: "#fffbf0" },
    { key: "new_tip_or_trick", label: "Uus nipp",           emoji: "💡", bg: "#f0fff8" },
    { key: "make_it_yours",    label: "Tee oma moodi",      emoji: "✨", bg: "#fff0f8" },
    { key: "why_it_fits",      label: "Miks see sobib",     emoji: "🩷", bg: "#fff8f8" },
    { key: "easier_version",   label: "Lihtsam versioon",   emoji: "🌱", bg: "#f0f8ff" },
  ];

  return (
    <div style={{ animation: "fadeUp .35s ease-out" }}>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
        @keyframes shimmer{0%{opacity:.6}50%{opacity:1}100%{opacity:.6}}
      `}</style>

      {/* Pealkiri */}
      <div style={{
        ...card, background: `linear-gradient(135deg, ${C.accentLight}, hsl(320,50%,93%))`,
        border: `1.5px solid ${C.accent}30`, textAlign: "center", marginBottom: 8,
      }}>
        <div style={{ fontSize: 11, letterSpacing: ".1em", color: C.accent, fontWeight: 500, marginBottom: 6, textTransform: "uppercase" }}>
          Sinu idee
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>
          {idea.idea_title}
        </div>
      </div>

      {/* Väljad */}
      {fields.map(f => (
        <div key={f.key} style={{ ...card, background: f.bg, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 8 }}>
          <div style={{ fontSize: 11, letterSpacing: ".08em", color: C.muted, fontWeight: 500, marginBottom: 5, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 14 }}>{f.emoji}</span> {f.label}
          </div>
          <div style={{ fontSize: 15, color: C.text, lineHeight: 1.55 }}>{idea[f.key]}</div>
        </div>
      ))}

      {/* Nupud */}
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button
          onClick={onRetry}
          style={{
            flex: 1, padding: "13px 0", borderRadius: 14,
            border: `1.5px solid ${C.border}`, background: "#fff",
            fontSize: 14, fontWeight: 500, color: C.muted, cursor: "pointer",
          }}
        >
          Veel üks idee ↺
        </button>
        <button
          onClick={onSave}
          style={{
            flex: 1, padding: "13px 0", borderRadius: 14,
            border: "none", background: saved ? C.green : C.accent,
            fontSize: 14, fontWeight: 600, color: "#fff", cursor: "pointer",
            transition: "background .2s",
          }}
        >
          {saved ? "✓ Salvestatud" : "Salvesta 🔖"}
        </button>
      </div>
    </div>
  );
}

// ── Loading ────────────────────────────────────────────────────────────────
function Loading() {
  return (
    <div style={{ textAlign: "center", padding: "48px 0" }}>
      <div style={{ fontSize: 40, marginBottom: 12, animation: "shimmer 1.2s infinite" }}>🎁</div>
      <div style={{ fontSize: 15, color: C.muted }}>Mõtlen välja midagi ägedat…</div>
      <style>{`@keyframes shimmer{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.12)}}`}</style>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function Ullata() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    with: null,
    materials: [],
    customMaterial: "",
    time: null,
    mood: [],
  });
  const [idea, setIdea] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const savedIdeas = useRef([]);

  function toggleArr(key, val) {
    setForm(f => ({
      ...f,
      [key]: f[key].includes(val) ? f[key].filter(x => x !== val) : [...f[key], val],
    }));
  }

  async function generate() {
    setLoading(true); setError(null); setIdea(null); setSaved(false);
    try {
      const result = await callClaude(buildPrompt(form));
      setIdea(result);
      setStep(4);
    } catch (e) {
      setError("Midagi läks valesti. Proovi uuesti.");
    } finally {
      setLoading(false);
    }
  }

  function retry() { generate(); }

  function saveIdea() {
    if (!idea) return;
    savedIdeas.current.push({ ...idea, savedAt: new Date().toISOString() });
    setSaved(true);
    try { localStorage.setItem("sade_saved_ideas", JSON.stringify(savedIdeas.current)); } catch {}
  }

  function restart() {
    setStep(0); setIdea(null); setError(null); setSaved(false);
    setForm({ with: null, materials: [], customMaterial: "", time: null, mood: [] });
  }

  const canNext = [
    !!form.with,
    form.materials.length > 0 || form.customMaterial.trim().length > 0,
    !!form.time,
    form.mood.length > 0,
  ];

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "20px 16px 80px", fontFamily: "var(--font-sans, system-ui, sans-serif)" }}>
      <div style={{ maxWidth: 440, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, letterSpacing: ".1em", color: C.accent, fontWeight: 500, textTransform: "uppercase", marginBottom: 4 }}>
            Üllata
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>
            {step < 4 ? "Mis teeme täna?" : idea?.idea_title ?? "Idee tulekul…"}
          </div>
        </div>

        {/* Stepper */}
        {step < 4 && !loading && <Stepper step={step} />}

        {/* Loading */}
        {loading && <Loading />}

        {/* Error */}
        {error && (
          <div style={{ ...card, borderColor: "#fca5a5", background: "#fff5f5", color: "#b91c1c", fontSize: 14 }}>
            {error}
            <button onClick={generate} style={{ marginLeft: 12, color: C.accent, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Proovi uuesti</button>
          </div>
        )}

        {/* Result */}
        {!loading && idea && step === 4 && (
          <>
            <IdeaCard idea={idea} onRetry={retry} onSave={saveIdea} saved={saved} />
            <button onClick={restart} style={{ width: "100%", marginTop: 12, padding: "11px 0", borderRadius: 12, border: `1px solid ${C.border}`, background: "none", fontSize: 13, color: C.muted, cursor: "pointer" }}>
              Alusta uuesti
            </button>
          </>
        )}

        {/* Steps */}
        {!loading && step < 4 && (
          <>
            {/* Step 0 — Kellega */}
            {step === 0 && (
              <div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {WITH_OPTIONS.map(o => (
                    <button
                      key={o.id}
                      onClick={() => setForm(f => ({ ...f, with: o.id }))}
                      style={{
                        display: "flex", alignItems: "center", gap: 14,
                        padding: "14px 18px", borderRadius: 16, cursor: "pointer",
                        border: `1.5px solid ${form.with === o.id ? C.accent : C.border}`,
                        background: form.with === o.id ? C.accentLight : C.card,
                        transition: "all .15s",
                      }}
                    >
                      <span style={{ fontSize: 22 }}>{o.emoji}</span>
                      <span style={{ fontSize: 16, fontWeight: 500, color: form.with === o.id ? C.accent : C.text }}>
                        {o.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 1 — Materjalid */}
            {step === 1 && (
              <div>
                <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Vali kõik mis sul olemas on</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                  {MATERIAL_OPTIONS.map(m => (
                    <button key={m} onClick={() => toggleArr("materials", m)} style={pill(form.materials.includes(m), true)}>
                      {m}
                    </button>
                  ))}
                </div>
                <input
                  placeholder="Midagi muud? Kirjuta siia…"
                  value={form.customMaterial}
                  onChange={e => setForm(f => ({ ...f, customMaterial: e.target.value }))}
                  style={{
                    width: "100%", padding: "10px 14px", borderRadius: 12,
                    border: `1.5px solid ${C.border}`, fontSize: 14,
                    background: C.card, color: C.text, outline: "none",
                  }}
                />
              </div>
            )}

            {/* Step 2 — Aeg */}
            {step === 2 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {TIME_OPTIONS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setForm(f => ({ ...f, time: t.id }))}
                    style={{
                      padding: "20px 16px", borderRadius: 16, cursor: "pointer", textAlign: "center",
                      border: `1.5px solid ${form.time === t.id ? C.accent : C.border}`,
                      background: form.time === t.id ? C.accentLight : C.card,
                      transition: "all .15s",
                    }}
                  >
                    <div style={{ fontSize: 20, fontWeight: 700, color: form.time === t.id ? C.accent : C.text }}>{t.label}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{t.sub}</div>
                  </button>
                ))}
              </div>
            )}

            {/* Step 3 — Mood */}
            {step === 3 && (
              <div>
                <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Vali 1–3 mis tunnet tahad</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {MOOD_OPTIONS.map(m => (
                    <button
                      key={m.id}
                      onClick={() => toggleArr("mood", m.id)}
                      style={pill(form.mood.includes(m.id), false)}
                    >
                      <span style={{ fontSize: 16 }}>{m.emoji}</span> {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Edasi / Genereeri */}
            <div style={{ marginTop: 24 }}>
              <button
                onClick={() => step < 3 ? setStep(s => s + 1) : generate()}
                disabled={!canNext[step]}
                style={{
                  width: "100%", padding: "15px 0", borderRadius: 16, border: "none",
                  background: canNext[step] ? C.accent : C.border,
                  color: canNext[step] ? "#fff" : C.muted,
                  fontSize: 16, fontWeight: 600, cursor: canNext[step] ? "pointer" : "default",
                  transition: "all .15s",
                }}
              >
                {step < 3 ? "Edasi →" : "Üllata mind! 🎁"}
              </button>

              {step > 0 && (
                <button
                  onClick={() => setStep(s => s - 1)}
                  style={{ width: "100%", marginTop: 10, padding: "11px 0", borderRadius: 12, border: "none", background: "none", fontSize: 13, color: C.muted, cursor: "pointer" }}
                >
                  ← Tagasi
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
