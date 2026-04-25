import { useState } from 'react';
import { AV, FONT, GRAD, card, inp, labelStyle, shell } from '../design/tokens';

const WITH_O = [
  { id: 'endale', l: 'Endale', e: '🌟' },
  { id: 'issi', l: 'Issiga koos', e: '🔧' },
  { id: 'emme', l: 'Emmega koos', e: '🌸' },
  { id: 'vanaema', l: 'Vanaemaga koos', e: '🧶' },
  { id: 'loomadele', l: 'Koerale või kassile', e: '🐾' },
];
const MAT_O = ['Paber ja pliiatsid', 'Värvipliiatsid või markerid', 'Käärid ja teip', 'Lõng või heegelnõel', 'Kleepsud ja washi-teip', 'Akvarellid', 'Telefon või kaamera'];
const TIME_O = [
  { id: 10, l: '10 min', s: 'kiire amps' },
  { id: 20, l: '20 min', s: 'mõnus' },
  { id: 30, l: '30 min', s: 'rahulik' },
  { id: 60, l: 'kauem', s: 'pikem projekt' },
];
const MOOD_O = [
  { id: 'joonista', l: 'joonista', e: '✏️' },
  { id: 'meisterda', l: 'meisterda', e: '✂️' },
  { id: 'armas', l: 'armas', e: '🩷' },
  { id: 'naljakas', l: 'naljakas', e: '😂' },
  { id: 'rahulik', l: 'rahulik', e: '🌿' },
  { id: 'maagiline', l: 'maagiline', e: '✨' },
  { id: 'kasulik', l: 'kasulik', e: '💡' },
  { id: 'üllatav', l: 'üllatav', e: '🎁' },
];

const SYS = `Sa oled soe ja loov ideekaaslane 10-13-aastasele tüdrukule. Anna üks selge ja teostatav idee tooniga "üks kasulik nipp, siis tee oma versioon". Vasta AINULT JSON-ina ilma markdown-ita:{"idea_title":"max 6 sõna","what_to_do":"2-3 lauset konkreetselt","why_it_fits":"1 lause","easy_start_tip":"1 lause kohe alustamiseks","new_tip_or_trick":"1 lause uuest oskusest","make_it_yours":"1 lause oma stiilis","easier_version":"1 lause lihtsam variant"}`;
const LOO_API_PATH = import.meta.env.VITE_LOO_API_PATH || '/api/ullata';
const SAVED_IDEAS_KEY = 'annivibe_saved_ideas';

const TIPS = [
  {
    id: 'b1',
    cat: 'põhitõed',
    emoji: '✍️',
    title: 'Kontuurjoonistus',
    what_it_helps_with: 'Aitab kuju ja piire paremini märgata.',
    explanation: 'Joonista asja välisjoon ja tähtsamad põhijooned. Nii näed paremini, mis kujuga asi päriselt on.',
    try_this: 'Vali tass, mänguasi või oma käsi ja joonista ainult selle põhijooned.',
    make_your_version: 'Lisa pärast muster, nägu või mõni naljakas detail.',
  },
  {
    id: 'b2',
    cat: 'põhitõed',
    emoji: '✍️',
    title: 'Vaata ja joonista',
    what_it_helps_with: 'Aitab päriselt vaatama õppida.',
    explanation: 'Vaata rohkem objekti kui paberit. Nii õpid märkama kuju, mitte ainult oletama.',
    try_this: 'Joonista 1 minuti jooksul oma käsi nii, et vaatad seda väga tähelepanelikult.',
    make_your_version: 'Proovi sama asja pärast uuesti juba oma stiilis.',
  },
  {
    id: 'b3',
    cat: 'põhitõed',
    emoji: '✍️',
    title: 'Kiire poosijoonistus',
    what_it_helps_with: 'Aitab tabada liikumist ja poosi.',
    explanation: 'Mõnikord ei ole tähtsad detailid, vaid see, kuidas keha liigub või seisab.',
    try_this: 'Joonista 30 sekundiga inimene istumas, jooksmas või hüppamas.',
    make_your_version: 'Tee sellest oma tegelane või Robloxi moodi kuju.',
  },
  {
    id: 'b4',
    cat: 'põhitõed',
    emoji: '✍️',
    title: 'Joonista vahed ka sisse',
    what_it_helps_with: 'Aitab näha kuju täpsemalt.',
    explanation: 'Mõnikord on lihtsam vaadata mitte asja ennast, vaid kujusid selle ümber.',
    try_this: 'Vaata tooli või taime ja joonista ka tühjad vahed selle sees ja ümber.',
    make_your_version: 'Kasuta seda nippi oma toa või riiuli joonistamisel.',
  },
  {
    id: 'b5',
    cat: 'põhitõed',
    emoji: '✍️',
    title: 'Hele ja tume',
    what_it_helps_with: 'Aitab teha pildi ruumilisemaks.',
    explanation: 'Kui üks koht on heledam ja teine tumedam, tundub ese pärisem ja ümaram.',
    try_this: 'Joonista pall või kuubik ja tee üks pool heledam, teine tumedam.',
    make_your_version: 'Proovi seda oma looma, näo või toa pildi juures.',
  },
  {
    id: 'b6',
    cat: 'põhitõed',
    emoji: '✍️',
    title: 'Viirutamine',
    what_it_helps_with: 'Aitab teha varju ja pinda.',
    explanation: 'Tee palju jooni ühes suunas. Mida tihedamalt jooned on, seda tumedam koht jääb.',
    try_this: 'Tee üks riba heledaks ja teine tumedaks ainult joonte abil.',
    make_your_version: 'Kasuta viirutamist juuste, riiete või puidu juures.',
  },
  {
    id: 'b7',
    cat: 'põhitõed',
    emoji: '✍️',
    title: 'Ristviirutamine',
    what_it_helps_with: 'Aitab teha tugevamat varju.',
    explanation: 'Kui jooned lähevad üksteisest üle erinevates suundades, saad tumedama ja huvitavama pinna.',
    try_this: 'Joonista tass või pall ja tee tumedam osa ristuvate joontega.',
    make_your_version: 'Proovi seda dramaatilise valgusega anime-pildis.',
  },
  {
    id: 'b8',
    cat: 'põhitõed',
    emoji: '✍️',
    title: 'Täpitamine',
    what_it_helps_with: 'Aitab teha tooni väikeste punktidega.',
    explanation: 'Varju saab teha ka paljude väikeste täppidega. See jätab pildi põnevaks ja veidi maagiliseks.',
    try_this: 'Joonista väike süda või loom ja tee üks koht tumedamaks punktidega.',
    make_your_version: 'Kasuta täpitamist tähtede, maagilise tolmu või öötaeva juures.',
  },
  {
    id: 'b9',
    cat: 'põhitõed',
    emoji: '✍️',
    title: 'Vaba joonega varjutus',
    what_it_helps_with: 'Aitab teha pehmemat ja elavamat pinda.',
    explanation: 'Kõik jooned ei pea olema sirged ja korralikud. Vaba joon võib teha pildi palju elavamaks.',
    try_this: 'Joonista pilv, loom või juuksed vabade joontega.',
    make_your_version: 'Lase käel liikuda julgemalt ja vaata, milline tunne pildile tuleb.',
  },
  {
    id: 'b10',
    cat: 'põhitõed',
    emoji: '✍️',
    title: 'Perspektiiv',
    what_it_helps_with: 'Aitab teha ruumi ja sügavust.',
    explanation: 'Kui kaugemad asjad lähevad väiksemaks ja jooned liiguvad kokku, tundub pilt ruumilisem.',
    try_this: 'Joonista tee, tuba või riiul nii, et kaugusesse minevad jooned liiguvad kokku.',
    make_your_version: 'Joonista oma unistuste tuba või väike mängumaailm.',
  },
  {
    id: 'b11',
    cat: 'põhitõed',
    emoji: '✍️',
    title: 'Suurused paika',
    what_it_helps_with: 'Aitab hoida pildi osad õiges suuruses.',
    explanation: 'Enne detaili lisamist vaata üle, kas üks asi ei ole teisest liiga suur või liiga väike.',
    try_this: 'Võrdle tassi ja lusika suurust või pea ja keha suurust.',
    make_your_version: 'Kasuta seda oma tegelase, looma või moejoonistuse juures.',
  },
  {
    id: 'b12',
    cat: 'põhitõed',
    emoji: '✍️',
    title: 'Alusta kujunditest',
    what_it_helps_with: 'Aitab keerulisi asju lihtsamaks teha.',
    explanation: 'Suur pilt muutub lihtsamaks, kui alustad ringist, ovaalist, kastist või kolmnurgast.',
    try_this: 'Tee koer ringist ja ovaalist, maja kastist ja kolmnurgast.',
    make_your_version: 'Kui põhikujud on paigas, muuda see täiesti oma tegelaseks või oma loomaks.',
  },
  {
    id: 'a1',
    cat: 'anime',
    emoji: '🌸',
    title: 'Ristiga nägu paika',
    what_it_helps_with: 'Silmad jäävad õigesse kohta',
    explanation: 'Enne näo detaile tee ringi sisse pehme rist. Püstjoon näitab näo keskjoont ja horisontaaljoon silmade joont.',
    try_this: 'Joonista üks nägu ainult ringi ja ristiga, siis lisa silmad täpselt ristijoonele.',
    make_your_version: 'Keera rist natuke viltu ja su tegelane hakkab justkui küljele vaatama.',
  },
  {
    id: 'a2',
    cat: 'anime',
    emoji: '🌸',
    title: 'Kulmud näitavad tunnet',
    what_it_helps_with: 'Sama nägu saab eri emotsiooni',
    explanation: 'Kui kulmud on pehmed ja kaardus, tundub nägu rahulik. Kui kulmud on teravamad ja viltu, on nägu kohe dramaatilisem.',
    try_this: 'Joonista üks lihtne nägu neli korda ja muuda ainult kulmude kuju.',
    make_your_version: 'Lisa oma tegelasele eriline kulmustiil, mida sa kasutad ainult temal.',
  },
  {
    id: 'l1',
    cat: 'loomad',
    emoji: '🐾',
    title: 'Loom ühest-kahest kujundist',
    what_it_helps_with: 'Alustad kiiresti ja kindlalt',
    explanation: 'Looma on lihtne alustada põhikujudest: pea ring, kõrvad kolmnurgad, keha ovaal. Kui kujud paigas, tulevad detailid kergelt.',
    try_this: 'Vali üks loom ja joonista ta esimeses versioonis ainult kujunditest.',
    make_your_version: 'Muuda üks kujund tahtlikult teistsuguseks ja vaata, milline oma stiil tekib.',
  },
  {
    id: 'v1',
    cat: 'värvid',
    emoji: '🎨',
    title: 'Kolm tooni annavad sügavuse',
    what_it_helps_with: 'Pilt ei jää liiga lame',
    explanation: 'Kasuta sama värvi tumedat, keskmist ja heledat tooni. Tume läheb varju, keskmine põhivärviks ja hele valguse kohale.',
    try_this: 'Joonista ring ja jaga ta kolmeks: tume serv, keskmine pind, hele täpp.',
    make_your_version: 'Proovi varjus ootamatut värvi, näiteks sinakat või lillakat.',
  },
  {
    id: 'k1',
    cat: 'kleepsud',
    emoji: '📒',
    title: 'Paks äär teeb kleepsu',
    what_it_helps_with: 'Joonistus näeb kohe välja nagu kleeps',
    explanation: 'Tee välisjoon paksem kui sisemised detailid. See väike vahe annab kohe kleepsu tunde.',
    try_this: 'Joonista väike ikoon ja mine teisel ringil üle ainult välisäär.',
    make_your_version: 'Lisa ümber valge või värviline halo, et kleeps veel rohkem esile tuleks.',
  },
];

async function askClaude(form, variationNonce = 0) {
  const safeVariationNonce = Number.isFinite(Number(variationNonce)) ? Math.max(0, Number.parseInt(String(variationNonce), 10)) : 0;
  const mats = [...form.mats, form.custom].filter(Boolean).join(', ') || 'mis käepärast';
  const payload = {
    with: form.with,
    materials: [...form.mats, form.custom].filter(Boolean),
    time: form.time,
    mood: form.mood,
    variationNonce: safeVariationNonce,
    systemPrompt: SYS,
    prompt: `Kellega: ${form.with}\nMaterjalid: ${mats}\nAega: ${form.time} min\nMood: ${form.mood.join(', ')}`,
  };

  function pick(arr, idx) {
    return arr[Math.abs(idx) % arr.length];
  }
  function hashSeed(value) {
    const s = String(value || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function buildLocalIdea() {
    const withLabel = WITH_O.find(x => x.id === form.with)?.l || 'Endale';
    const firstMood = form.mood?.[0] || 'maagiline';
    const firstMaterial = [...form.mats, form.custom].filter(Boolean)[0] || 'paber ja pliiatsid';
    const timeLabel = TIME_O.find(t => t.id === form.time)?.l || '20 min';
    const seed = hashSeed(`${form.with}|${form.time}|${form.mood?.join(',')}|${firstMaterial}|${safeVariationNonce}`);

    const titles = [
      'Väike loov hetk',
      'Tee see oma moodi',
      'Armas mini-projekt',
      'Maagiline väike idee',
      'Loome midagi koos',
    ];
    const starters = {
      joonista: 'Tee 60-sekundiline visand',
      meisterda: 'Vali üks lihtne vorm ja hakka ehitama',
      armas: 'Lisa üks pehme detail',
      naljakas: 'Pane sisse üks naljakas pööre',
      rahulik: 'Tee aeglases tempos, ilma kiirustamata',
      maagiline: 'Lisa sära või salajane detail',
      kasulik: 'Tee asi, mida saad päriselt kasutada',
      üllatav: 'Lõppu lisa väike üllatus',
    };

    return {
      idea_title: pick(titles, seed),
      what_to_do: `Tee ${timeLabel} jooksul väike projekt ${withLabel.toLowerCase()} koos, kasutades ${firstMaterial}. Alusta ühest lihtsast kujust või ideest, lisa 2-3 detaili ja lõpeta värviga, mis teeb tuju heaks.`,
      why_it_fits: `See sobib sulle, sest valisid "${firstMood}" meeleolu ja see mahub mõnusalt sinu valitud aega.`,
      easy_start_tip: `${starters[firstMood] || starters.maagiline}. Esimene samm võiks kesta ainult 2 minutit.`,
      new_tip_or_trick: 'Kasuta üht paksumat joont või üht varjutooni, siis jääb töö kohe selgem.',
      make_it_yours: 'Lisa oma märk: süda, täht, muster või värvipaar, mis on just sinu moodi.',
      easier_version: 'Kui aega jääb väheks, tee sama idee mini-versioonina ainult ühe põhidetailiga.',
      source: 'local',
    };
  }

  try {
    const res = await fetch(LOO_API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return buildLocalIdea();
    }
    const data = await res.json();
    const idea = data?.idea ?? data;
    if (!idea || typeof idea !== 'object') {
      return buildLocalIdea();
    }
    if (typeof data?.source === 'string' && !idea.source) {
      return { ...idea, source: data.source };
    }
    return idea;
  } catch {
    return buildLocalIdea();
  }
}

const CAT_C = {
  'põhitõed': { bg: AV.purpleL, border: `${AV.purpleM}`, accent: AV.purple },
  anime: { bg: AV.roseL, border: `${AV.rose}40`, accent: AV.rose },
  loomad: { bg: AV.sageL, border: `${AV.sage}40`, accent: AV.sage },
  värvid: { bg: AV.peachL, border: `${AV.peach}40`, accent: AV.peach },
  kleepsud: { bg: 'hsl(55,80%,95%)', border: 'hsl(55,60%,85%)', accent: 'hsl(45,80%,50%)' },
};
function catC(cat) {
  return CAT_C[cat] || { bg: AV.purpleL, border: `${AV.purple}40`, accent: AV.purple };
}
function hashSeed(value) {
  const s = String(value || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
function readSavedIdeas() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_IDEAS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeSavedIdeas(next) {
  try {
    localStorage.setItem(SAVED_IDEAS_KEY, JSON.stringify(next));
  } catch {}
}
function pill(active) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '7px 14px',
    fontSize: 13,
    borderRadius: 100,
    border: `1.5px solid ${active ? AV.purple : AV.border}`,
    background: active ? AV.purpleL : AV.bg,
    color: active ? AV.purple : AV.muted,
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  };
}

export default function LooTab() {
  const [view, setView] = useState('home');
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ with: null, mats: [], custom: '', time: null, mood: [] });
  const [variationNonce, setVariationNonce] = useState(0);
  const [idea, setIdea] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savedIdea, setSavedIdea] = useState(false);
  const [cat, setCat] = useState(null);
  const [tip, setTip] = useState(null);
  const [savedTips, setSavedTips] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('sade_saved_tips') || '[]'));
    } catch {
      return new Set();
    }
  });

  function tog(k, v) {
    setForm(f => ({ ...f, [k]: f[k].includes(v) ? f[k].filter(x => x !== v) : [...f[k], v] }));
  }
  function buildSavedIdeaItem() {
    if (!idea) return null;

    const material = [...form.mats, form.custom].filter(Boolean);
    const title = (idea.idea_title || idea.title || '').trim();
    const text = (idea.what_to_do || idea.text || '').trim();
    const type = idea.type || 'ullata';
    const source = idea.source || 'unknown';
    const signature = JSON.stringify({
      title,
      text,
      type,
      with: form.with,
      time: form.time,
      mood: form.mood,
      material,
      source,
    });

    return {
      id: idea.id || `ullata_${hashSeed(signature)}`,
      createdAt: idea.createdAt || new Date().toISOString(),
      title,
      text,
      type,
      meta: {
        with: form.with,
        time: form.time,
        mood: form.mood,
        material,
        source,
      },
    };
  }
  function saveIdea() {
    const nextItem = buildSavedIdeaItem();
    if (!nextItem) return;

    const existing = readSavedIdeas();
    const duplicate = existing.some(item => item?.id === nextItem.id || (item?.title === nextItem.title && item?.text === nextItem.text && item?.type === nextItem.type));
    if (!duplicate) {
      writeSavedIdeas([...existing, nextItem]);
    }
    setSavedIdea(true);
  }
  async function gen() {
    const nextVariationNonce = variationNonce + 1;
    setVariationNonce(nextVariationNonce);
    setSavedIdea(false);
    setLoading(true);
    try {
      setIdea(await askClaude(form, nextVariationNonce));
      setStep(4);
    } catch {
      setIdea(null);
      setSavedIdea(false);
    } finally {
      setLoading(false);
    }
  }
  function saveTip(id) {
    setSavedTips(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try {
        localStorage.setItem('sade_saved_tips', JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  const canNext = [!!form.with, form.mats.length > 0 || form.custom.trim().length > 0, !!form.time, form.mood.length > 0];

  if (view === 'home')
    return (
      <div style={shell}>
        <div style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 10, ...labelStyle }}>Loo</div>
          <div style={{ fontFamily: FONT.display, fontSize: 28, fontWeight: 600, color: AV.text, lineHeight: 1.2, marginBottom: 6 }}>Mida loome täna?</div>
          <div style={{ fontSize: 14, color: AV.muted, lineHeight: 1.6, maxWidth: 440 }}>Vali, kas tahad üht head ideed või kiiret nippi.</div>
        </div>
        {[
          { id: 'ullata', e: '🎁', title: 'Üllata', sub: 'Vasta neljale küsimusele ja saad ühe teostatava idee.', bg: GRAD.hero, bd: `${AV.purple}25`, hint: '~5 min' },
          { id: 'nipid', e: '✏️', title: 'Joonistamise nipid', sub: 'Õpi üks nipp ja keera see oma versiooniks.', bg: `linear-gradient(135deg,${AV.roseL},${AV.peachL})`, bd: `${AV.rose}25`, hint: `${TIPS.length} nippi` },
        ].map(c => (
          <button
            key={c.id}
            onClick={() => {
              if (c.id === 'ullata') {
                setView('ullata');
                setStep(0);
                setIdea(null);
                setVariationNonce(0);
                setSavedIdea(false);
              } else {
                setView('cats');
              }
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              padding: '23px 20px',
              marginBottom: 12,
              background: c.bg,
              border: `1px solid ${c.bd}`,
              borderRadius: 22,
              cursor: 'pointer',
              textAlign: 'left',
              boxShadow: AV.shadowSm,
              transition: 'transform .15s,box-shadow .15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'scale(1.012)';
              e.currentTarget.style.boxShadow = AV.shadow;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = '';
              e.currentTarget.style.boxShadow = AV.shadowSm;
            }}
          >
            <span style={{ fontSize: 44, flexShrink: 0 }}>{c.e}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: AV.text }}>{c.title}</span>
                <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.62)', color: AV.textSoft, padding: '2px 8px', borderRadius: 20 }}>{c.hint}</span>
              </div>
              <div style={{ fontSize: 14, color: AV.textSoft, lineHeight: 1.5 }}>{c.sub}</div>
            </div>
            <span style={{ fontSize: 20, color: AV.muted }}>→</span>
          </button>
        ))}
        <div style={{ marginTop: 18, padding: '15px 18px', background: 'hsl(35,30%,94%)', borderRadius: 16, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: AV.muted, fontFamily: FONT.display, fontStyle: 'italic' }}>✨ Nipp ei sunni — nipp annab alguse. Sina annad pildile elu.</p>
        </div>
      </div>
    );

  if (view === 'ullata')
    return (
      <div style={{ ...shell, animation: 'av-in .2s' }}>
        <button
          onClick={() => {
            setView('home');
            setVariationNonce(0);
            setSavedIdea(false);
          }}
          style={{ background: 'none', border: 'none', fontSize: 14, color: AV.muted, cursor: 'pointer', marginBottom: 16 }}
        >
          ← Loo
        </button>
        <div style={{ fontSize: 10, ...labelStyle }}>Üllata</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: AV.text, marginBottom: 20 }}>{step < 4 ? 'Mis tuju loominguks on?' : idea?.idea_title ?? ''}</div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 44, animation: 'av-bounce 1.2s infinite' }}>🎁</div>
            <div style={{ fontSize: 15, color: AV.muted, marginTop: 12 }}>Panen sulle ühe hea idee kokku…</div>
          </div>
        )}

        {!loading && step === 4 && idea && (
          <div style={{ animation: 'av-in .3s' }}>
            <div style={{ ...card, background: AV.purpleL, border: `1.5px solid ${AV.purpleM}`, textAlign: 'center', marginBottom: 10, boxShadow: 'none' }}>
              <div style={{ fontSize: 10, ...labelStyle, color: AV.purple, marginBottom: 6 }}>Sinu tänane idee</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: AV.text, lineHeight: 1.3 }}>{idea.idea_title}</div>
            </div>
            {[
              ['what_to_do', 'Mida teha', '📋', '#f8f6ff'],
              ['easy_start_tip', 'Alusta kohe', '⚡', '#fffbf0'],
              ['new_tip_or_trick', 'Uus nipp', '💡', '#f0fff8'],
              ['make_it_yours', 'Tee oma moodi', '✨', '#fff0f8'],
              ['easier_version', 'Lihtsam variant', '🌱', '#f0f8ff'],
            ].map(([k, l2, e, bg]) => (
              <div key={k} style={{ ...card, background: bg, boxShadow: 'none' }}>
                <div style={{ fontSize: 10, ...labelStyle, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                  <span style={{ fontSize: 14 }}>{e}</span>
                  {l2}
                </div>
                <p style={{ fontSize: 15, color: AV.text, margin: 0, lineHeight: 1.6 }}>{idea[k]}</p>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={gen} style={{ flex: 1, padding: '13px 0', borderRadius: 14, border: `1px solid ${AV.border}`, background: '#fff', fontSize: 13, fontWeight: 500, color: AV.muted, cursor: 'pointer' }}>Uus idee ↺</button>
              <button onClick={saveIdea} style={{ flex: 1, padding: '13px 0', borderRadius: 14, border: 'none', background: savedIdea ? AV.sage : AV.purple, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {savedIdea ? '✓ Salvestatud' : 'Salvesta 🔖'}
              </button>
            </div>
            <button
              onClick={() => {
                setStep(0);
                setIdea(null);
                setVariationNonce(0);
                setSavedIdea(false);
                setForm({ with: null, mats: [], custom: '', time: null, mood: [] });
              }}
              style={{ width: '100%', marginTop: 10, padding: '11px 0', borderRadius: 12, border: 'none', background: 'none', fontSize: 13, color: AV.muted, cursor: 'pointer' }}
            >
              Tee uus valik
            </button>
          </div>
        )}

        {!loading && step < 4 && (
          <>
            {step === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {WITH_O.map(o => (
                  <button
                    key={o.id}
                    onClick={() => setForm(f => ({ ...f, with: o.id }))}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '14px 18px',
                      borderRadius: 16,
                      cursor: 'pointer',
                      textAlign: 'left',
                      border: `1.5px solid ${form.with === o.id ? AV.purple : AV.border}`,
                      background: form.with === o.id ? AV.purpleL : AV.card,
                      transition: 'all .15s',
                      boxShadow: AV.shadowSm,
                    }}
                  >
                    <span style={{ fontSize: 22 }}>{o.e}</span>
                    <span style={{ fontSize: 16, fontWeight: 500, color: form.with === o.id ? AV.purple : AV.text }}>{o.l}</span>
                  </button>
                ))}
              </div>
            )}
            {step === 1 && (
              <div>
                <div style={{ fontSize: 13, color: AV.muted, marginBottom: 12 }}>Vali, mis sul praegu olemas on</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                  {MAT_O.map(m => (
                    <button key={m} onClick={() => tog('mats', m)} style={pill(form.mats.includes(m))}>
                      {m}
                    </button>
                  ))}
                </div>
                <input placeholder="Muu vahend..." value={form.custom} onChange={e => setForm(f => ({ ...f, custom: e.target.value }))} style={{ ...inp }} />
              </div>
            )}
            {step === 2 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {TIME_O.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setForm(f => ({ ...f, time: t.id }))}
                    style={{
                      padding: '20px',
                      borderRadius: 16,
                      cursor: 'pointer',
                      textAlign: 'center',
                      border: `1.5px solid ${form.time === t.id ? AV.purple : AV.border}`,
                      background: form.time === t.id ? AV.purpleL : AV.card,
                      boxShadow: AV.shadowSm,
                    }}
                  >
                    <div style={{ fontSize: 20, fontWeight: 700, color: form.time === t.id ? AV.purple : AV.text }}>{t.l}</div>
                    <div style={{ fontSize: 12, color: AV.muted, marginTop: 3 }}>{t.s}</div>
                  </button>
                ))}
              </div>
            )}
            {step === 3 && (
              <div>
                <div style={{ fontSize: 13, color: AV.muted, marginBottom: 12 }}>Vali 1–3 tunnet või stiili</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {MOOD_O.map(m => (
                    <button key={m.id} onClick={() => tog('mood', m.id)} style={pill(form.mood.includes(m.id))}>
                      <span style={{ fontSize: 16 }}>{m.e}</span>
                      {m.l}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={{ marginTop: 24 }}>
              <button
                onClick={() => (step < 3 ? setStep(s => s + 1) : gen())}
                disabled={!canNext[step]}
                style={{ width: '100%', padding: '15px 0', borderRadius: 16, border: 'none', background: canNext[step] ? AV.purple : AV.border, color: '#fff', fontSize: 16, fontWeight: 600, cursor: canNext[step] ? 'pointer' : 'default' }}
              >
                {step < 3 ? 'Edasi →' : 'Üllata mind! 🎁'}
              </button>
              {step > 0 && (
                <button onClick={() => setStep(s => s - 1)} style={{ width: '100%', marginTop: 10, padding: '11px 0', borderRadius: 12, border: 'none', background: 'none', fontSize: 13, color: AV.muted, cursor: 'pointer' }}>
                  ← Tagasi
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );

  if (view === 'cats')
    return (
      <div style={{ ...shell, animation: 'av-in .2s' }}>
        <button onClick={() => setView('home')} style={{ background: 'none', border: 'none', fontSize: 14, color: AV.muted, cursor: 'pointer', marginBottom: 16 }}>← Loo</button>
        <div style={{ fontSize: 10, ...labelStyle }}>Joonistamise nipid</div>
        <div style={{ fontFamily: FONT.display, fontSize: 22, fontWeight: 600, color: AV.text, marginBottom: 6 }}>Mida tahad täna proovida?</div>
        <div style={{ fontSize: 14, color: AV.muted, marginBottom: 20 }}>Vali teema, võta üks nipp ja tee see oma moodi.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[...new Set(TIPS.map(t => t.cat))].map(c => {
            const cc = catC(c);
            const count = TIPS.filter(t => t.cat === c).length;
            const icons = { 'põhitõed': '✍️', anime: '🌸', loomad: '🐾', värvid: '🎨', kleepsud: '📒' };
            const labels = { 'põhitõed': 'Joonistamise põhitõed', anime: 'Anime & kawaii', loomad: 'Loomad', värvid: 'Värvid ja varjud', kleepsud: 'Kleepsud' };
            return (
              <button
                key={c}
                onClick={() => {
                  setCat(c);
                  setView('list');
                }}
                style={{
                  background: cc.bg,
                  border: `1.5px solid ${cc.border}`,
                  borderRadius: 20,
                  padding: '18px 16px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  transition: 'transform .12s',
                  boxShadow: AV.shadowSm,
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.03)')}
                onMouseLeave={e => (e.currentTarget.style.transform = '')}
              >
                <span style={{ fontSize: 28 }}>{icons[c] || '✨'}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: AV.text }}>{labels[c] || c}</span>
                <span style={{ fontSize: 12, color: AV.muted }}>{count} nippi</span>
              </button>
            );
          })}
        </div>
      </div>
    );

  if (view === 'list') {
    const catTips = TIPS.filter(t => t.cat === cat);
    const cc = catC(cat);
    const catName = { 'põhitõed': 'Joonistamise põhitõed', anime: 'Anime & kawaii', loomad: 'Loomad', värvid: 'Värvid ja varjud', kleepsud: 'Kleepsud' }[cat] || cat;
    return (
      <div style={{ ...shell, animation: 'av-in .2s' }}>
        <button onClick={() => setView('cats')} style={{ background: 'none', border: 'none', fontSize: 14, color: AV.muted, cursor: 'pointer', marginBottom: 16 }}>← Kategooriad</button>
        <div style={{ fontSize: 10, ...labelStyle }}>Joonistamise nipid</div>
        <div style={{ fontFamily: FONT.display, fontSize: 22, fontWeight: 600, color: AV.text, marginBottom: 20 }}>{catName}</div>
        {catTips.map(t => (
          <button
            key={t.id}
            onClick={() => {
              setTip(t);
              setView('detail');
            }}
            style={{ ...card, cursor: 'pointer', textAlign: 'left', width: '100%', display: 'flex', alignItems: 'center', gap: 14, borderLeft: `4px solid ${cc.accent}`, transition: 'box-shadow .15s' }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = AV.shadow)}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = AV.shadowSm)}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: AV.text, marginBottom: 4 }}>
                {t.title}
                {savedTips.has(t.id) && <span style={{ marginLeft: 8, fontSize: 12, color: AV.sage }}>✓</span>}
              </div>
              <div style={{ fontSize: 12, background: cc.bg, color: AV.textSoft, display: 'inline-block', padding: '2px 8px', borderRadius: 20, marginBottom: 4 }}>{t.what_it_helps_with}</div>
              <div style={{ fontSize: 13, color: AV.muted }}>{t.explanation.slice(0, 60)}…</div>
            </div>
            <span style={{ color: AV.muted }}>→</span>
          </button>
        ))}
      </div>
    );
  }

  if (view === 'detail' && tip) {
    const cc = catC(tip.cat);
    const catTips = TIPS.filter(t => t.cat === tip.cat);
    const idx = catTips.findIndex(t => t.id === tip.id);
    const hasNext = idx < catTips.length - 1;
    return (
      <div style={{ ...shell, animation: 'av-in .2s' }}>
        <button onClick={() => setView('list')} style={{ background: 'none', border: 'none', fontSize: 14, color: AV.muted, cursor: 'pointer', marginBottom: 16 }}>← Tagasi</button>
        <div style={{ background: cc.bg, border: `1.5px solid ${cc.border}`, borderRadius: 20, padding: '20px', marginBottom: 12 }}>
          <div style={{ fontSize: 11, ...labelStyle, color: cc.accent, marginBottom: 5 }}>{tip.what_it_helps_with}</div>
          <h3 style={{ fontSize: 22, fontWeight: 700, color: AV.text, margin: 0, lineHeight: 1.3 }}>{tip.title}</h3>
        </div>
        {[
          ['explanation', 'Miks see aitab', '💬', cc.bg],
          ['try_this', 'Proovi kohe', '✏️', 'hsl(55,80%,95%)'],
          ['make_your_version', 'Tee oma moodi', '✨', AV.purpleL],
        ].map(([k, l2, e, bg]) => (
          <div key={k} style={{ ...card, background: bg, boxShadow: 'none' }}>
            <div style={{ fontSize: 10, ...labelStyle, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>{e}</span>
              {l2}
            </div>
            <p style={{ fontSize: 15, color: AV.text, margin: 0, lineHeight: 1.6 }}>{tip[k]}</p>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => hasNext && setTip(catTips[idx + 1])} disabled={!hasNext} style={{ flex: 1, padding: '13px 0', borderRadius: 14, border: `1px solid ${AV.border}`, background: '#fff', fontSize: 13, color: hasNext ? AV.muted : AV.border, cursor: hasNext ? 'pointer' : 'default' }}>
            Järgmine nipp ↓
          </button>
          <button onClick={() => saveTip(tip.id)} style={{ flex: 1, padding: '13px 0', borderRadius: 14, border: 'none', background: savedTips.has(tip.id) ? AV.sage : AV.purple, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {savedTips.has(tip.id) ? '✓ Salvestatud' : 'Salvesta 🔖'}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
