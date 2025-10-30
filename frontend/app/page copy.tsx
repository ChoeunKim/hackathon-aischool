"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Volume2, ShoppingCart, ArrowLeft, Check, X, Plus, Minus, Home, CircleHelp } from "lucide-react";

// ===== Backend API base =====
const API = "http://localhost:8000";
const USE_LLM_NLU = true; // keep compatibility with existing NLU endpoints

// ===== Types from backend =====
// (Matches /menus/popular and /ingredients in backend)
// See main.py for fields
export type Menu = {
  id: number;
  name: string;
  description: string;
  image_url: string;
  price_cents: number;
  price_15_cents?: number | null;
  price_30_cents?: number | null;
  popular_rank: number;
};
export type Ingredient = { id: number; name: string; type: string };

// Ingredient categories expected from backend `Ingredient.type`
// If your DB already categorizes ingredients, keep these exact strings.
// Otherwise map them in the DB seed: bread / cheese / vegetable / sauce / extra
const CATEGORY_ORDER = ["bread", "cheese", "vegetable", "sauce", "extra"] as const;

type IngredientOps = { ADD: string[]; EXCLUDE: string[] };
export type CartItem = {
  menu_id: number;        // chosen theme (=Menu)
  name: string;           // theme name
  size_cm: 15 | 30;       // 15 or 30
  quantity: number;       // default 1
  picks: {
    bread?: string | null;
    cheese?: string | null;
    vegetables: string[]; // multi
    sauces: string[];     // multi
    extras: string[];     // multi and optional
  };
  // Keep compatibility with existing server payload shape
  ingredients_ops: IngredientOps; // derived from picks (vegetables/sauces) when calling API
};

// ===== State machine =====
// Subway-style branching: first screen asks "추천" or "직접선택"
// For direct flow: THEME -> BREAD -> CHEESE -> VEGETABLES -> SAUCE -> EXTRAS(optional) -> REVIEW
// For recommended flow: RECO_LIST -> RECO_DETAIL (yes/no) -> (no -> BREAD) OR (yes -> EXTRAS) -> REVIEW

type KioskState =
  | "START"             // splash
  | "MODE_SELECT"       // 추천 vs 직접선택
  | "THEME_SELECT"      // direct: choose main theme (Menu)
  | "BREAD_SELECT"
  | "CHEESE_SELECT"
  | "VEGE_SELECT"
  | "SAUCE_SELECT"
  | "EXTRA_SELECT"      // optional (skip allowed)
  | "REVIEW"            // confirm current item; can add more items
  | "RECO_LIST"         // recommended 4 combos
  | "RECO_DETAIL"       // show expanded combo; ask Yes/No
  | "PAYMENT"           // create order on server, show receipt, quantity edits
  | "END";              // done

// ===== Utilities =====
function speakKo(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR"; u.rate = 1.0; u.pitch = 1.0;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
const uniq = (arr: string[]) => Array.from(new Set(arr));

// Build ingredient_ops (for server compatibility) from current picks
function buildIngredientOps(picks: CartItem["picks"]): IngredientOps {
  // In this Subway-like UX, we treat chosen vegetables/sauces as ADD and assume others are excluded by omission.
  // If you prefer true EXCLUDE semantics, compute EXCLUDE against full catalog here.
  return {
    ADD: uniq([...picks.vegetables, ...picks.sauces, ...picks.extras]),
    EXCLUDE: [],
  };
}

export default function Page() {
  // ----- Voice & STT UI state (kept from original) -----
  const [isRecording, setIsRecording] = useState(false);
  const [audioURL, setAudioURL] = useState<string>("");
  const [sttText, setSttText] = useState<string>("");
  const [status, setStatus] = useState<string>("idle");

  // ----- Data from backend -----
  const [menus, setMenus] = useState<Menu[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [menusLoading, setMenusLoading] = useState(false);
  const [menusError, setMenusError] = useState<string | null>(null);

  // ----- Order state -----
  const [cart, setCart] = useState<CartItem[]>([]);
  const [working, setWorking] = useState<CartItem | null>(null); // current item being composed
  const [orderId, setOrderId] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<any>(null);

  // ----- Cancel confirmation -----
  const [cancelConfirm, setCancelConfirm] = useState(false);

  // ----- Flow control -----
  const [state, setState] = useState<KioskState>("START");

  // ===== Effects: load menus and ingredients =====
  useEffect(() => {
    // Load popular menus once we enter THEME_SELECT or RECO_LIST
    if (state === "THEME_SELECT" || state === "RECO_LIST") {
      setMenusLoading(true);
      setMenusError(null);
      fetch(`${API}/menus/popular`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((rows: Menu[]) => setMenus(rows))
        .catch((e) => { console.error(e); setMenusError("인기 메뉴 조회에 실패했습니다."); setMenus([]); })
        .finally(() => setMenusLoading(false));
    }
  }, [state]);

  useEffect(() => {
    // Load full ingredient catalog when entering any ingredient step
    if (["BREAD_SELECT","CHEESE_SELECT","VEGE_SELECT","SAUCE_SELECT","EXTRA_SELECT"].includes(state)) {
      fetch(`${API}/ingredients`).then((r) => r.json()).then((rows: Ingredient[]) => setIngredients(rows)).catch(() => setIngredients([]));
    }
  }, [state]);

  // ===== Voice prompts =====
  useEffect(() => {
    switch (state) {
      case "START":
        speakKo("음성으로 주문하려면 버튼을 누르세요. 시작을 누르면 추천 또는 직접 선택이 가능합니다.");
        break;
      case "MODE_SELECT":
        speakKo("추천 메뉴 또는 직접 선택 중에서 선택해주세요.");
        break;
      case "THEME_SELECT":
        speakKo("샌드위치 테마를 선택해주세요. K바비큐, 스테이크 앤 치즈, 로스트 치킨, 이탈리안 비엠티 등.");
        break;
      case "BREAD_SELECT": speakKo("빵을 선택해주세요. 허니 오트, 플랫, 파마산 오레가노, 위트 중에서 고르세요."); break;
      case "CHEESE_SELECT": speakKo("치즈를 선택해주세요. 슈레드, 아메리칸, 모짜렐라 중에서 고르세요."); break;
      case "VEGE_SELECT": speakKo("야채를 선택해주세요. 양상추, 토마토, 오이, 피망, 양파, 피클, 할라피뇨, 올리브."); break;
      case "SAUCE_SELECT": speakKo("소스를 선택해주세요. 랜치, 래디쉬, 올리브오일, 스위트칠리, 핫칠리, 레드와인식초, 마요네즈, 후추 소스."); break;
      case "EXTRA_SELECT": speakKo("추가 선택입니다. 에그마요, 페퍼로니, 베이컨, 아보카도, 오믈렛. 건너뛰기 가능."); break;
      case "REVIEW": speakKo("주문 내역을 확인해주세요. 결제하시겠습니까, 추가 주문하시겠습니까, 또는 취소하시겠습니까?"); break;
      case "RECO_LIST": speakKo("추천 메뉴 네 가지 중 하나를 선택해주세요."); break;
      case "RECO_DETAIL": speakKo("이 조합 그대로 진행하시겠습니까? 예 또는 아니오를 선택해주세요."); break;
      case "PAYMENT": speakKo("주문을 서버로 전송했습니다. 수량 변경이나 삭제가 가능합니다."); break;
      case "END": speakKo("주문이 완료되었습니다. 감사합니다."); break;
    }
  }, [state]);

  // ===== Recording (minimal – identical logic as original) =====
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const preferredTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  const startRecording = async () => {
    setSttText(""); setStatus("requesting mic...");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let mimeType = ""; for (const t of preferredTypes) if ((MediaRecorder as any).isTypeSupported?.(t)) { mimeType = t; break; }
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = mr; chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      setAudioURL(URL.createObjectURL(blob)); setStatus(`recorded ${Math.round(blob.size/1024)} KB`);
      uploadAndTranscribe(blob);
    };
    mr.start(); setIsRecording(true); setStatus("recording...");
  };
  const stopRecording = () => {
    const mr = mediaRecorderRef.current; if (mr && mr.state !== "inactive") { mr.stop(); mr.stream.getTracks().forEach((t)=>t.stop()); }
    setIsRecording(false); setStatus("stopped");
  };

  const goHome = () => {
    const mr = mediaRecorderRef.current; if (mr && mr.state !== "inactive") { mr.stop(); mr.stream.getTracks().forEach((t)=>t.stop()); }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setAudioURL(""); setSttText(""); setStatus("idle");
    setCart([]); setOrderId(null); setReceipt(null); setWorking(null);
    setState("START");
  };

  // ===== Voice NLU =====
  // Keep a simple text-based handler that supports YES/NO and CANCEL, plus a few keywords for modes.
  const runTextNLU = async (text: string) => {
    const phrase = text.trim(); if (!phrase) return;
    setSttText(phrase); setStatus("transcribed");

    // quick client-side routes for mode selection
    if (state === "MODE_SELECT") {
      if (/추천/.test(phrase)) { setState("RECO_LIST"); return; }
      if (/직접|디렉트|커스텀/.test(phrase)) { beginDirect(); return; }
    }
    if (/취소|그만|홈으로|처음으로/.test(phrase)) { setCancelConfirm(true); speakKo("홈으로 돌아가시겠습니까? 예 또는 아니오로 말씀해주세요."); return; }
    if (cancelConfirm) {
      if (/^(예|네|응)$/i.test(phrase)) { setCancelConfirm(false); goHome(); return; }
      if (/^(아니오|아니)$/i.test(phrase)) { setCancelConfirm(false); speakKo("취소하지 않습니다."); return; }
    }

    // For confirmation prompts in RECO_DETAIL
    if (state === "RECO_DETAIL") {
      if (/^(예|네|응)$/i.test(phrase)) { // proceed with combo as-is -> extras
        if (working) { setWorking({ ...working }); setState("EXTRA_SELECT"); }
        return;
      }
      if (/^(아니오|아니)$/i.test(phrase)) { // lock theme, go to bread
        setState("BREAD_SELECT"); return;
      }
    }

    // Fallback to server NLU for generic intents (ORDER_CONFIRM/GO_BACK/CONFIRM_YES/NO)
    const knownNames = ingredients.length
      ? ingredients.map((i) => i.name)
      : ["양상추","토마토","오이","피망","양파","피클","할라피뇨","올리브","랜치","래디쉬","올리브오일","스위트칠리","핫칠리","레드와인식초","마요네즈","후추","에그마요","페퍼로니","베이컨","아보카도","오믈렛"];
    const nluEndpoint = USE_LLM_NLU ? `${API}/nlu_llm` : `${API}/nlu`;
    const body = USE_LLM_NLU ? { text: phrase, context: state, menu_count: menus.length || 10, known_ingredients: knownNames } : { text: phrase, context: state };
    try {
      const res = await fetch(nluEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const nlu = await res.json();
      handleIntent(nlu.intent as string);
    } catch {}
  };

  const uploadAndTranscribe = async (blobArg?: Blob) => {
    const useBlob = blobArg ?? (audioURL ? await fetch(audioURL).then((r) => r.blob()) : null);
    if (!useBlob) return alert("먼저 녹음하세요.");
    setStatus("transcribing..."); setSttText("");
    const ext = useBlob.type.includes("webm") ? "webm" : useBlob.type.includes("mp4") ? "mp4" : useBlob.type.includes("m4a") ? "m4a" : "webm";
    const fd = new FormData(); fd.append("file", useBlob, `record.${ext}`);
    const resp = await fetch(`${API}/transcribe`, { method: "POST", body: fd });
    if (!resp.ok) { setStatus(`error: transcribe failed ${resp.status}`); return; }
    const data = await resp.json(); if (!data.text || !data.text.trim()) { setStatus("error: empty transcription result"); return; }
    setSttText(data.text); setStatus("transcribed");
    await runTextNLU(data.text);
  };

  const handleIntent = (intent: string) => {
    if (cancelConfirm) {
      if (intent === "CONFIRM_YES") { setCancelConfirm(false); goHome(); return; }
      if (intent === "CONFIRM_NO") { setCancelConfirm(false); speakKo("취소하지 않습니다."); return; }
    }
    if (intent === "CANCEL_ORDER") { setCancelConfirm(true); speakKo("홈으로 돌아가시겠습니까? 예 또는 아니오로 말씀해주세요."); return; }
    if (intent === "GO_BACK") {
      // Back one step in direct flow
      const backMap: Record<KioskState, KioskState> = {
        START: "START", MODE_SELECT: "START", THEME_SELECT: "MODE_SELECT", BREAD_SELECT: "THEME_SELECT",
        CHEESE_SELECT: "BREAD_SELECT", VEGE_SELECT: "CHEESE_SELECT", SAUCE_SELECT: "VEGE_SELECT", EXTRA_SELECT: "SAUCE_SELECT",
        REVIEW: "MODE_SELECT", RECO_LIST: "MODE_SELECT", RECO_DETAIL: "RECO_LIST", PAYMENT: "REVIEW", END: "START"
      };
      setState((s) => backMap[s] ?? "MODE_SELECT");
    }
    if (intent === "ORDER_CONFIRM") {
      // From REVIEW -> PAYMENT
      if (state === "REVIEW") confirmAndSend();
    }
  };

  // ===== High level flow helpers =====
  const beginDirect = () => {
    // reset working item
    setWorking({
      menu_id: 0, name: "", size_cm: 15, quantity: 1,
      picks: { bread: null, cheese: null, vegetables: [], sauces: [], extras: [] },
      ingredients_ops: { ADD: [], EXCLUDE: [] },
    });
    setState("THEME_SELECT");
  };

  const selectTheme = (m: Menu) => {
    if (!working) beginDirect();
    setWorking((w) => w ? { ...w, menu_id: m.id, name: m.name, size_cm: 15 } : w);
    setState("BREAD_SELECT");
  };

  const selectBread = (name: string) => { if (!working) return; setWorking({ ...working, picks: { ...working.picks, bread: name }}); setState("CHEESE_SELECT"); };
  const selectCheese = (name: string) => { if (!working) return; setWorking({ ...working, picks: { ...working.picks, cheese: name }}); setState("VEGE_SELECT"); };

  const togglePick = (cat: "vegetables"|"sauces"|"extras", name: string) => {
    if (!working) return;
    const now = new Set(working.picks[cat]);
    if (now.has(name)) now.delete(name); else now.add(name);
    setWorking({ ...working, picks: { ...working.picks, [cat]: Array.from(now) as any }});
  };

  const doneVegetables = () => { setState("SAUCE_SELECT"); };
  const doneSauces = () => { setState("EXTRA_SELECT"); };
  const skipExtras = () => { pushWorkingToCart(); };

  const pushWorkingToCart = () => {
    if (!working) return;
    const ops = buildIngredientOps(working.picks);
    const next: CartItem = { ...working, ingredients_ops: ops };
    setCart((prev) => [...prev, next]);
    setWorking(null);
    setState("REVIEW");
  };

  const addMore = () => {
    setWorking(null);
    setState("MODE_SELECT");
  };

  const confirmAndSend = async () => {
    if (cart.length === 0) { speakKo("담긴 항목이 없습니다."); return; }
    try {
      const r = await fetch(`${API}/orders`, { method: "POST" });
      const d = await r.json(); const oid = d.order_id as number; setOrderId(oid);
      for (const it of cart) {
        await fetch(`${API}/orders/${oid}/items`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ menu_id: it.menu_id, quantity: it.quantity, size_cm: it.size_cm, ingredients_ops: it.ingredients_ops }),
        });
      }
      const rec = await fetch(`${API}/orders/${oid}`).then((r) => r.json()); setReceipt(rec);
      await fetch(`${API}/orders/${oid}/confirm`, { method: "POST" });
      setState("PAYMENT");
      setCart([]);
      speakKo("주문이 완료되었습니다. 감사합니다.");
    } catch (e) { console.error("confirm failed", e); speakKo("주문에 실패했습니다. 다시 시도해주세요."); }
  };

  // ===== Helpers for filtering ingredients by category =====
  const byCat = (cat: Ingredient["type"]) => ingredients.filter((i) => i.type === cat);

  // ===== Recommended combos (static examples bound to real Menu themes) =====
  const recommended = (menus.slice(0, 4) || []).map((m, i) => ({
    theme: m,
    combo: [
      // baked-in Subway-style combos; adapt as needed
      { bread: "허니오트", cheese: "아메리칸", vegetables: ["양상추","토마토","오이"], sauces: ["랜치"], extras: [] },
      { bread: "플랫", cheese: "모짜렐라", vegetables: ["양상추","양파","피클"], sauces: ["스위트칠리"], extras: [] },
      { bread: "파마산오레가노", cheese: "슈레드", vegetables: ["양상추","토마토","올리브"], sauces: ["마요네즈","후추"], extras: [] },
      { bread: "위트", cheese: "아메리칸", vegetables: ["토마토","피망","할라피뇨"], sauces: ["레드와인식초"], extras: [] },
    ][i % 4]
  }));

  const chooseRecommended = (rec: { theme: Menu; combo: any }) => {
    // Show expanded card and ask Yes/No (RECO_DETAIL)
    setWorking({
      menu_id: rec.theme.id,
      name: rec.theme.name,
      size_cm: 15,
      quantity: 1,
      picks: { bread: rec.combo.bread, cheese: rec.combo.cheese, vegetables: rec.combo.vegetables, sauces: rec.combo.sauces, extras: [] },
      ingredients_ops: buildIngredientOps({ bread: rec.combo.bread, cheese: rec.combo.cheese, vegetables: rec.combo.vegetables, sauces: rec.combo.sauces, extras: [] }),
    });
    setState("RECO_DETAIL");
  };

  // ===== UI =====
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              {state !== "START" && state !== "END" && (
                <button onClick={goHome} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="처음으로">
                  <Home className="w-5 h-5" />
                </button>
              )}
              <h1 className="text-xl font-bold text-gray-900">음성주문 키오스크</h1>
            </div>
            {orderId && state !== "START" && state !== "END" && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <ShoppingCart className="w-4 h-4" />
                <span>주문번호: {orderId}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* START */}
        {state === "START" && (
          <div className="flex flex-col items-center justify-center min-h-[70vh]">
            <div className="text-center">
              <div className="w-32 h-32 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-8">
                <Volume2 className="w-16 h-16 text-white" />
              </div>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">음성으로 간편하게 주문하세요</h2>
              <p className="text-gray-600 mb-8">시작을 누르면 "추천" 또는 "직접선택"을 고를 수 있어요.</p>
              <button onClick={() => setState("MODE_SELECT")} className="bg-green-500 text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-green-600 transition-colors shadow-lg">주문 시작하기</button>
            </div>
          </div>
        )}

        {/* MODE_SELECT: 추천 vs 직접선택 */}
        {state === "MODE_SELECT" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <button className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition p-6 text-left" onClick={() => setState("RECO_LIST")}> 
              <h3 className="text-2xl font-bold text-gray-900 mb-2">추천 메뉴</h3>
              <p className="text-gray-600">키오스크가 추천하는 베스트 조합 4가지를 보여드립니다.</p>
            </button>
            <button className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition p-6 text-left" onClick={beginDirect}> 
              <h3 className="text-2xl font-bold text-gray-900 mb-2">직접 선택</h3>
              <p className="text-gray-600">테마 → 빵 → 치즈 → 야채 → 소스 → 추가 순서로 직접 구성합니다.</p>
            </button>

            <VoicePanel {...{ isRecording, startRecording, stopRecording, uploadAndTranscribe, audioURL, status, sttText, runTextNLU }} />
          </div>
        )}

        {/* THEME_SELECT */}
        {state === "THEME_SELECT" && (
          <section>
            <SectionHeader title="샌드위치 테마 선택" hint="K바비큐, 스테이크&치즈, 로스트 치킨, 이탈리안 B.M.T 등" />
            {menusLoading && <Loader text="메뉴를 불러오는 중..." />}
            {menusError && <ErrorBox text={menusError} />}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {menus.slice(0, 10).map((m) => (
                <button key={m.id} onClick={() => selectTheme(m)} className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow border border-gray-200 overflow-hidden text-left">
                  <div className="aspect-square bg-gray-100">{m.image_url ? <img src={m.image_url} alt={m.name} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center text-gray-400">이미지 없음</div>}</div>
                  <div className="p-3">
                    <h3 className="font-semibold text-gray-900 mb-1">{m.name}</h3>
                    <p className="text-sm text-gray-600">{typeof m.price_15_cents === "number" ? `₩${(m.price_15_cents/100).toLocaleString()}~` : typeof m.price_cents === "number" ? `₩${(m.price_cents/100).toLocaleString()}` : "가격 정보 없음"}</p>
                  </div>
                </button>
              ))}
            </div>
            <Tip bullets={["뒤로 가려면 '이전'이라고 말하세요.", "취소하면 첫 화면으로 돌아갑니다."]} />
            <VoicePanel {...{ isRecording, startRecording, stopRecording, uploadAndTranscribe, audioURL, status, sttText, runTextNLU }} />
          </section>
        )}

        {/* BREAD_SELECT */}
        {state === "BREAD_SELECT" && (
          <SelectorStep title="빵 선택" items={byCat("bread")} selected={[working?.picks.bread || ""]} onPick={(n) => selectBread(n)} multi={false} footer={
            <NavRow onBack={() => setState("THEME_SELECT")} onNext={() => setState("CHEESE_SELECT")} nextDisabled={!working?.picks.bread} />
          } />
        )}

        {/* CHEESE_SELECT */}
        {state === "CHEESE_SELECT" && (
          <SelectorStep title="치즈 선택" items={byCat("cheese")} selected={[working?.picks.cheese || ""]} onPick={(n) => selectCheese(n)} multi={false} footer={
            <NavRow onBack={() => setState("BREAD_SELECT")} onNext={() => setState("VEGE_SELECT")} nextDisabled={!working?.picks.cheese} />
          } />
        )}

        {/* VEGE_SELECT */}
        {state === "VEGE_SELECT" && (
          <SelectorStep title="야채 선택" items={byCat("vegetable")} selected={working?.picks.vegetables || []} onPick={(n) => togglePick("vegetables", n)} multi={true} footer={
            <NavRow onBack={() => setState("CHEESE_SELECT")} onNext={doneVegetables} />
          } />
        )}

        {/* SAUCE_SELECT */}
        {state === "SAUCE_SELECT" && (
          <SelectorStep title="소스 선택" items={byCat("sauce")} selected={working?.picks.sauces || []} onPick={(n) => togglePick("sauces", n)} multi={true} footer={
            <NavRow onBack={() => setState("VEGE_SELECT")} onNext={doneSauces} />
          } />
        )}

        {/* EXTRA_SELECT (optional) */}
        {state === "EXTRA_SELECT" && (
          <SelectorStep title="추가 선택 (선택 사항)" items={byCat("extra")} selected={working?.picks.extras || []} onPick={(n) => togglePick("extras", n)} multi={true} footer={
            <div className="flex gap-3">
              <button onClick={() => setState("SAUCE_SELECT")} className="flex-1 bg-white text-gray-900 border-2 border-gray-300 px-6 py-4 rounded-lg font-semibold hover:bg-gray-50 transition-colors">이전</button>
              <button onClick={skipExtras} className="flex-1 bg-gray-200 text-gray-900 px-6 py-4 rounded-lg font-semibold hover:bg-gray-300 transition-colors">건너뛰기</button>
              <button onClick={pushWorkingToCart} className="flex-1 bg-green-500 text-white px-6 py-4 rounded-lg font-semibold hover:bg-green-600 transition-colors shadow-lg">선택 완료</button>
            </div>
          } />
        )}

        {/* RECOMMENDED LIST */}
        {state === "RECO_LIST" && (
          <section>
            <SectionHeader title="추천 메뉴" hint="베스트 4가지 조합을 보여드립니다." />
            {menusLoading && <Loader text="메뉴를 불러오는 중..." />}
            {menusError && <ErrorBox text={menusError} />}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {recommended.map((r, idx) => (
                <button key={r.theme.id} onClick={() => chooseRecommended(r)} className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow border border-gray-200 overflow-hidden text-left">
                  <div className="aspect-video bg-gray-100">{r.theme.image_url ? <img src={r.theme.image_url} alt={r.theme.name} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center text-gray-400">이미지 없음</div>}</div>
                  <div className="p-3">
                    <div className="text-sm text-gray-500">추천 #{idx+1}</div>
                    <h3 className="font-semibold text-gray-900 mb-1">{r.theme.name}</h3>
                    <p className="text-xs text-gray-600">{r.combo.bread} / {r.combo.cheese} / {r.combo.vegetables.join(", ")} / {r.combo.sauces.join(", ")}</p>
                  </div>
                </button>
              ))}
            </div>
            <Tip bullets={["추천 조합을 눌러 자세히 보고 선택하세요.", "'직접선택'으로 돌아가려면 이전을 누르세요."]} />
            <VoicePanel {...{ isRecording, startRecording, stopRecording, uploadAndTranscribe, audioURL, status, sttText, runTextNLU }} />
          </section>
        )}

        {/* RECOMMENDED DETAIL */}
        {state === "RECO_DETAIL" && working && (
          <section>
            <SectionHeader title="추천 조합 확인" hint="이대로 진행하시겠습니까? 예/아니오" />
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">{working.name}</h3>
              <ul className="text-gray-800 space-y-1">
                <li><b>빵</b>: {working.picks.bread}</li>
                <li><b>치즈</b>: {working.picks.cheese}</li>
                <li><b>야채</b>: {working.picks.vegetables.join(", ") || "없음"}</li>
                <li><b>소스</b>: {working.picks.sauces.join(", ") || "없음"}</li>
              </ul>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setState("BREAD_SELECT")} className="flex-1 bg-white text-gray-900 border-2 border-gray-300 px-6 py-4 rounded-lg font-semibold hover:bg-gray-50 transition-colors">아니오 (빵부터 변경)</button>
              <button onClick={() => setState("EXTRA_SELECT")} className="flex-1 bg-green-500 text-white px-6 py-4 rounded-lg font-semibold hover:bg-green-600 transition-colors shadow-lg">예 (추가 선택으로)</button>
            </div>
            <VoicePanel {...{ isRecording, startRecording, stopRecording, uploadAndTranscribe, audioURL, status, sttText, runTextNLU }} />
          </section>
        )}

        {/* REVIEW (cart pre-confirmation) */}
        {state === "REVIEW" && (
          <section>
            <SectionHeader title="주문 확인" hint="추가 주문을 누르면 2단계(모드 선택)부터 다시 시작합니다." />
            {cart.length === 0 ? (
              <p className="text-gray-500">장바구니가 비어있습니다.</p>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                <ul className="space-y-4">
                  {cart.map((it, i) => (
                    <li key={i} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex justify-between">
                        <div>
                          <div className="font-semibold text-gray-900">{it.name} <span className="text-gray-600">({it.size_cm}cm)</span></div>
                          <div className="text-xs text-gray-500 mt-1">
                            {it.picks.bread} / {it.picks.cheese} / {it.picks.vegetables.join(", ")} / {it.picks.sauces.join(", ")}
                            {it.picks.extras.length ? ` / +${it.picks.extras.join(", ")}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setCart((prev) => prev.map((c, idx) => idx===i ? { ...c, quantity: Math.max(1, c.quantity-1) } : c))} className="p-2 border rounded-lg"><Minus className="w-4 h-4"/></button>
                          <span className="px-3 font-medium">{it.quantity}</span>
                          <button onClick={() => setCart((prev) => prev.map((c, idx) => idx===i ? { ...c, quantity: c.quantity+1 } : c))} className="p-2 border rounded-lg"><Plus className="w-4 h-4"/></button>
                          <button onClick={() => setCart((prev) => prev.filter((_, idx) => idx!==i))} className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg">삭제</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={addMore} className="flex-1 bg-white text-gray-900 border-2 border-gray-300 px-6 py-4 rounded-lg font-semibold hover:bg-gray-50 transition-colors">추가 주문</button>
              <button onClick={confirmAndSend} className="flex-1 bg-green-500 text-white px-6 py-4 rounded-lg font-semibold hover:bg-green-600 transition-colors shadow-lg">주문 확정</button>
            </div>
            <VoicePanel {...{ isRecording, startRecording, stopRecording, uploadAndTranscribe, audioURL, status, sttText, runTextNLU }} />
          </section>
        )}

        {/* PAYMENT (server receipt and edits) */}
        {state === "PAYMENT" && (
          <section>
            <SectionHeader title="결제 내역" hint="수량 변경 또는 항목 삭제가 가능합니다." />
            {orderId && (
              <ServerReceipt orderId={orderId} receipt={receipt} setReceipt={setReceipt} />
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={goHome} className="flex-1 bg-white text-gray-900 border-2 border-gray-300 px-6 py-4 rounded-lg font-semibold hover:bg-gray-50 transition-colors">처음으로</button>
              <button onClick={() => setState("END")} className="flex-1 bg-green-500 text-white px-6 py-4 rounded-lg font-semibold hover:bg-green-600 transition-colors shadow-lg">완료</button>
            </div>
          </section>
        )}

        {/* END */}
        {state === "END" && (
          <div className="flex flex-col items-center justify-center min-h-[70vh]">
            <div className="text-center">
              <div className="w-32 h-32 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-8">
                <Check className="w-16 h-16 text-white" />
              </div>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">주문이 완료되었습니다</h2>
              <p className="text-gray-600 mb-8">감사합니다!</p>
              <button onClick={goHome} className="bg-green-500 text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-green-600 transition-colors shadow-lg">처음으로 돌아가기</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ===== Reusable widgets =====
function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">{title}</h2>
      {hint && <p className="text-gray-600 flex items-center gap-2"><CircleHelp className="w-4 h-4"/> {hint}</p>}
    </div>
  );
}
function Tip({ bullets }: { bullets: string[] }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-sm text-blue-900">
      {bullets.map((b, i) => (<div key={i}>💡 {b}</div>))}
    </div>
  );
}
function Loader({ text }: { text: string }) {
  return (
    <div className="text-center py-12">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto"></div>
      <p className="mt-4 text-gray-600">{text}</p>
    </div>
  );
}
function ErrorBox({ text }: { text: string }) {
  return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">{text}</div>;
}

function SelectorStep({ title, items, selected, onPick, multi, footer }:{
  title: string;
  items: Ingredient[];
  selected: string[];
  onPick: (name: string) => void;
  multi: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <section>
      <SectionHeader title={title} />
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        {items.length === 0 ? (
          <p className="text-gray-500">선택 가능한 항목이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {items.map((ing) => {
              const isActive = selected.includes(ing.name);
              return (
                <button key={ing.id} onClick={() => onPick(ing.name)} className={`p-3 rounded-lg border-2 transition-all text-left ${isActive ? "border-green-500 bg-green-50" : "border-gray-200 bg-gray-50 hover:border-gray-300"}`}>
                  <div className="font-medium text-gray-900">{ing.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{ing.type}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {footer}
      <VoicePanelSimple />
    </section>
  );
}

function NavRow({ onBack, onNext, nextDisabled }: { onBack: ()=>void; onNext: ()=>void; nextDisabled?: boolean }) {
  return (
    <div className="flex gap-3">
      <button onClick={onBack} className="flex-1 bg-white text-gray-900 border-2 border-gray-300 px-6 py-4 rounded-lg font-semibold hover:bg-gray-50 transition-colors">이전</button>
      <button onClick={onNext} disabled={nextDisabled} className="flex-1 bg-green-500 text-white px-6 py-4 rounded-lg font-semibold hover:bg-green-600 transition-colors shadow-lg disabled:bg-gray-300 disabled:cursor-not-allowed">다음</button>
    </div>
  );
}

function ServerReceipt({ orderId, receipt, setReceipt }:{ orderId: number; receipt: any; setReceipt: (x:any)=>void; }) {
  useEffect(() => {
    fetch(`${API}/orders/${orderId}`).then((r) => r.json()).then(setReceipt).catch(()=>{});
  }, [orderId, setReceipt]);
  if (!receipt) return <Loader text="영수증을 불러오는 중..."/>;
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
      <h3 className="font-semibold text-gray-900 mb-4 pb-3 border-b border-gray-200">주문 내역</h3>
      {Array.isArray(receipt?.items) && receipt.items.length > 0 ? (
        <div className="space-y-4">
          {receipt.items.map((it: any) => (
            <div key={it.id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900">{it.name}</h4>
                  <p className="text-sm text-gray-600">{it.size_cm ?? 15}cm</p>
                  {it.ingredients_ops && (it.ingredients_ops.ADD?.length || it.ingredients_ops.EXCLUDE?.length) && (
                    <div className="text-xs text-gray-500 mt-1">
                      {it.ingredients_ops.ADD?.length > 0 && `+ ${it.ingredients_ops.ADD.join(", ")}`}
                      {it.ingredients_ops.EXCLUDE?.length > 0 && ` - ${it.ingredients_ops.EXCLUDE.join(", ")}`}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="font-semibold text-gray-900">₩{(((it.unit_price_cents ?? it.price_cents ?? 0) * it.quantity) / 100).toLocaleString()}</div>
                  <div className="text-sm text-gray-600">₩{((it.unit_price_cents ?? it.price_cents ?? 0) / 100).toLocaleString()} × {it.quantity}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-top border-gray-100">
                <div className="flex items-center border border-gray-300 rounded-lg">
                  <button onClick={() => {
                    fetch(`${API}/orders/${orderId}/items/${it.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "dec", delta: 1 })})
                      .then(() => fetch(`${API}/orders/${orderId}`).then((r)=>r.json()).then(setReceipt));
                  }} className="p-2 hover:bg-gray-100 transition-colors"><Minus className="w-4 h-4"/></button>
                  <span className="px-4 font-medium">{it.quantity}</span>
                  <button onClick={() => {
                    fetch(`${API}/orders/${orderId}/items/${it.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "inc", delta: 1 })})
                      .then(() => fetch(`${API}/orders/${orderId}`).then((r)=>r.json()).then(setReceipt));
                  }} className="p-2 hover:bg-gray-100 transition-colors"><Plus className="w-4 h-4"/></button>
                </div>
                <button onClick={() => {
                  fetch(`${API}/orders/${orderId}/items/${it.id}`, { method: "DELETE" })
                    .then(() => fetch(`${API}/orders/${orderId}`).then((r)=>r.json()).then(setReceipt));
                }} className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors">삭제</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-500 text-center py-8">장바구니가 비어있습니다</p>
      )}
      <div className="border-t border-gray-200 mt-6 pt-4 flex justify-between items-center">
        <span className="text-lg font-semibold text-gray-900">총 결제금액</span>
        <span className="text-2xl font-bold text-green-600">₩{(receipt.total_cents / 100).toLocaleString()}</span>
      </div>
    </div>
  );
}

function VoicePanel({ isRecording, startRecording, stopRecording, uploadAndTranscribe, audioURL, status, sttText, runTextNLU }:{
  isRecording: boolean;
  startRecording: ()=>void;
  stopRecording: ()=>void;
  uploadAndTranscribe: ()=>void;
  audioURL: string; status: string; sttText: string;
  runTextNLU: (t: string)=>void;
}) {
  const [textCmd, setTextCmd] = useState("");
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mt-6">
      <h3 className="font-semibold text-gray-900 mb-4">음성 입력</h3>
      <div className="flex items-center gap-3 mb-4">
        {!isRecording ? (
          <button onClick={startRecording} className="flex items-center gap-2 bg-green-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-green-600 transition-colors shadow-md"><Mic className="w-5 h-5"/> 녹음 시작</button>
        ) : (
          <button onClick={stopRecording} className="flex items-center gap-2 bg-red-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-red-600 transition-colors shadow-md animate-pulse"><MicOff className="w-5 h-5"/> 녹음 중지</button>
        )}
        <button onClick={uploadAndTranscribe} disabled={!audioURL} className="flex items-center gap-2 bg-blue-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed">음성 인식</button>
        <div className="flex-1 text-sm text-gray-600">상태: <span className="font-medium">{status}</span></div>
      </div>
      <div className="mt-4 border-t border-gray-200 pt-4">
        <h4 className="text-sm font-semibold text-gray-900 mb-2">텍스트로 테스트</h4>
        <div className="flex gap-2">
          <input value={textCmd} onChange={(e)=>setTextCmd(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter'){ runTextNLU(textCmd); setTextCmd(""); } }} placeholder='예: "추천", "직접선택", "예", "아니오", "취소"' className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"/>
          <button onClick={()=>{ runTextNLU(textCmd); setTextCmd(""); }} className="bg-blue-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-600 transition-colors">실행</button>
        </div>
      </div>
      {sttText && (
        <div className="bg-gray-50 rounded-lg p-4 mt-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">인식된 텍스트</h4>
          <p className="text-gray-900">{sttText}</p>
        </div>
      )}
    </div>
  );
}

function VoicePanelSimple() {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-sm text-blue-900">
      💡 각 단계에서 음성으로도 선택 가능합니다. "취소"라고 말하면 언제든 첫 화면으로 돌아갑니다.
    </div>
  );
}
