"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Volume2, ShoppingCart, ArrowLeft, Check, X, Plus, Minus } from "lucide-react";

const API = "http://localhost:8000";
const USE_LLM_NLU = true;

type Menu = {
  id: number;
  name: string;
  description: string;
  image_url: string;
  price_cents: number;
  price_15_cents?: number | null;
  price_30_cents?: number | null;
  popular_rank: number;
};

type Ingredient = {
  id: number;
  name: string;
  type: string;
};

type KioskState =
  | "START"
  | "MAIN_MENU"
  | "MENU_DETAIL"
  | "VEGETABLE_SELECTION"
  | "ORDER_CONFIRM"
  | "END";

type IngredientOps = { ADD: string[]; EXCLUDE: string[] };
type CartItem = {
  menu_id: number;
  name: string;
  size_cm: 15 | 30;
  quantity: number;
  ingredients_ops: IngredientOps;
};

function speakKo(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = 1.0;
  u.pitch = 1.0;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
const uniq = (arr: string[]) => Array.from(new Set(arr));

export default function Page() {
  // ---- UI / STT ----
  const [isRecording, setIsRecording] = useState(false);
  const [audioURL, setAudioURL] = useState<string>("");
  const [sttText, setSttText] = useState<string>("");
  const [status, setStatus] = useState<string>("idle");

  // ---- Data ----
  const [menus, setMenus] = useState<Menu[]>([]);
  const [menusLoading, setMenusLoading] = useState(false);
  const [menusError, setMenusError] = useState<string | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [orderId, setOrderId] = useState<number | null>(null); // 확정 시 생성
  const [receipt, setReceipt] = useState<any>(null);           // 확정 후 서버 영수증
  const [cart, setCart] = useState<CartItem[]>([]);            // 로컬 장바구니
  const [cancelConfirm, setCancelConfirm] = useState(false);   // 전역 취소 확인

  const [sizeCm, setSizeCm] = useState<15 | 30>(15);
  const [ingredientOps, setIngredientOps] = useState<IngredientOps>({ ADD: [], EXCLUDE: [] });

  // ---- State Machine / NLU ----
  const [state, setState] = useState<KioskState>("START");
  const [nluResult, setNluResult] = useState<any>(null);

  // ---- MediaRecorder ----
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // -------- Effects --------
  useEffect(() => {
    switch (state) {
      case "START":
        speakKo("음성으로 주문하려면 버튼을 눌러주세요.");
        break;
      case "MAIN_MENU":
        speakKo("원하는 메뉴의 번호를 말씀해주세요.");
        break;
      case "MENU_DETAIL":
        speakKo("메뉴 설명을 듣고 싶으면 메뉴 설명해줘, 주문하려면 주문하기 라고 말해주세요.");
        break;
      case "VEGETABLE_SELECTION":
        speakKo("예시: 양파 빼고 전부 추가해줘, 랜치 소스만 넣어줘.");
        break;
      case "ORDER_CONFIRM":
        speakKo("주문 완료하시겠습니까? 주문하기, 추가 주문, 또는 취소라고 말씀해주세요.");
        break;
      case "END":
        speakKo("주문이 완료되었습니다. 감사합니다.");
        break;
    }
  }, [state]);

  // MAIN_MENU: 메뉴 로드 + 화면 초기화 (주문 생성은 하지 않음)
  useEffect(() => {
    if (state !== "MAIN_MENU") return;

    setSelectedMenu(null);
    setReceipt(null);
    setIngredientOps({ ADD: [], EXCLUDE: [] });
    setSizeCm(15);

    setMenusLoading(true);
    setMenusError(null);
    fetch(`${API}/menus/popular`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Menu[]) => setMenus(data))
      .catch((err) => {
        console.error(err);
        setMenusError("인기 메뉴 조회에 실패했습니다.");
        setMenus([]);
      })
      .finally(() => setMenusLoading(false));
  }, [state]);

  // VEGETABLE_SELECTION: 재료 목록
  useEffect(() => {
    if (state !== "VEGETABLE_SELECTION") return;
    fetch(`${API}/ingredients`)
      .then((res) => res.json())
      .then((rows: Ingredient[]) => setIngredients(rows))
      .catch((err) => {
        console.error("load ingredients failed", err);
        setIngredients([]);
      });
  }, [state]);

  // ORDER_CONFIRM: 서버 영수증(확정 전엔 receipt 없음)
  useEffect(() => {
    if (state !== "ORDER_CONFIRM" || !orderId) return;
    fetch(`${API}/orders/${orderId}`)
      .then((res) => res.json())
      .then(setReceipt)
      .catch((err) => {
        console.error("get receipt failed", err);
        setReceipt(null);
      });
  }, [state, orderId]);

  // -------- Recording --------
  const preferredTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  const startRecording = async () => {
    setSttText("");
    setStatus("requesting mic...");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let mimeType = "";
    for (const t of preferredTypes) if ((MediaRecorder as any).isTypeSupported?.(t)) { mimeType = t; break; }
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = mr;
    chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      setAudioURL(URL.createObjectURL(blob));
      setStatus(`recorded ${Math.round(blob.size / 1024)} KB`);
      // 정지 즉시 전사 + NLU
      uploadAndTranscribe(blob);
    };
    mr.start();
    setIsRecording(true);
    setStatus("recording...");
  };
  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.stop();
      mr.stream.getTracks().forEach((t) => t.stop());
      setIsRecording(false);
      setStatus("stopped");
    }
  };

  const goHome = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.stop();
      mr.stream.getTracks().forEach((t) => t.stop());
      setIsRecording(false);
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setAudioURL("");
    setSttText("");
    setNluResult(null);
    setStatus("idle");
    setSizeCm(15);
    setCart([]);
    setOrderId(null);
    setReceipt(null);
    setSelectedMenu(null);
    setState("START");
  };

  // 텍스트로 NLU 수행 (음성 없이)
  async function runTextNLU(text: string) {
    if (!text.trim()) return;
    setSttText(text);         // STT 결과처럼 화면에 표시
    setStatus("transcribed"); // 상태도 동일하게

    const knownNames = ingredients.length
      ? ingredients.map((i) => i.name)
      : ["양파","할라피뇨","피클","토마토","올리브","랜치","머스타드","마요","스위트어니언"];

    const nluEndpoint = USE_LLM_NLU ? `${API}/nlu_llm` : `${API}/nlu`;
    const body = USE_LLM_NLU
      ? { text, context: state, menu_count: menus.length || 10, known_ingredients: knownNames }
      : { text, context: state };

    const nluRes = await fetch(nluEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const nlu = await nluRes.json();
    setNluResult(nlu);
    handleIntent(nlu.intent, nlu.slots);
  }
  const onTextSubmit = (t: string) => { runTextNLU(t).catch(console.error); };

  // -------- STT → NLU --------
  const uploadAndTranscribe = async (blobArg?: Blob) => {
    const useBlob = blobArg ?? (audioURL ? await fetch(audioURL).then((r) => r.blob()) : null);
    if (!useBlob) return alert("먼저 녹음하세요.");

    setStatus("transcribing...");
    setSttText("");

    const blob = useBlob;
    const ext =
      blob.type.includes("webm") ? "webm" :
      blob.type.includes("mp4")  ? "mp4"  :
      blob.type.includes("m4a")  ? "m4a"  : "webm";
    const fd = new FormData();
    fd.append("file", blob, `record.${ext}`);

    const resp = await fetch(`${API}/transcribe`, { method: "POST", body: fd });
    if (!resp.ok) {
      const t = await resp.text();
      console.error("Transcribe failed", resp.status, t);
      setStatus(`error: transcribe failed ${resp.status}`);
      return;
    }
    const data = await resp.json();
    if (!data.text || data.text.trim().length === 0) {
      setStatus("error: empty transcription result");
      return;
    }
    setSttText(data.text);
    setStatus("transcribed");

    const knownNames = ingredients.length
      ? ingredients.map((i) => i.name)
      : ["양파","할라피뇨","피클","토마토","올리브","랜치","머스타드","마요","스위트어니언"];

    const nluEndpoint = USE_LLM_NLU ? `${API}/nlu_llm` : `${API}/nlu`;
    const body = USE_LLM_NLU
      ? { text: data.text, context: state, menu_count: menus.length || 10, known_ingredients: knownNames }
      : { text: data.text, context: state };

    const nluRes = await fetch(nluEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const nlu = await nluRes.json();
    setNluResult(nlu);
    console.log("[NLU]", nlu);
    handleIntent(nlu.intent, nlu.slots);
  };

  // -------- Intent Handler --------
  const handleIntent = async (intent: string, slots: any) => {
    // 취소 확인 단계 우선
    if (cancelConfirm) {
      if (intent === "CONFIRM_YES") {
        if (orderId) {
          fetch(`${API}/orders/${orderId}/cancel`, { method: "POST" }).catch(() => {});
        }
        setCancelConfirm(false);
        speakKo("초기 화면으로 돌아갑니다.");
        goHome();
        return;
      }
      if (intent === "CONFIRM_NO") {
        setCancelConfirm(false);
        speakKo("취소하지 않습니다. 계속 진행하세요.");
        return;
      }
    }

    // 전역 취소 트리거
    if (intent === "CANCEL_ORDER") {
      setCancelConfirm(true);
      speakKo("홈으로 돌아가시겠습니까? 예 또는 아니오로 말씀해주세요.");
      return;
    }

    switch (state) {
      case "START":
        break;

      case "MAIN_MENU":
        if (intent === "SELECT_MENU") {
          const n = Number(slots?.menu_number);
          if (Number.isFinite(n) && n >= 1 && n <= menus.length) setSelectedMenu(menus[n - 1]);
          setSizeCm(15);
          setState("MENU_DETAIL");
        }
        break;

      case "MENU_DETAIL":
        if (intent === "READ_MENU_DESC") {
          selectedMenu?.description && speakKo(selectedMenu.description);
        } else if (intent === "ORDER_CONFIRM") {
          setIngredientOps({ ADD: [], EXCLUDE: [] });
          setState("VEGETABLE_SELECTION");
        } else if (intent === "GO_BACK") {
          setState("MAIN_MENU");
        }
        break;

      case "VEGETABLE_SELECTION":
        if (intent === "SET_INGREDIENTS") {
          const ops: string[] = slots?.ops ?? [];
          const items: string[] = slots?.items ?? [];
          let next: IngredientOps = { ...ingredientOps };

          if (ops.includes("ONLY")) {
            next = { ADD: uniq(items), EXCLUDE: [] };
          } else {
            if (ops.includes("ADD")) {
              next.ADD = uniq([...next.ADD, ...items]);
              next.EXCLUDE = next.EXCLUDE.filter((x) => !next.ADD.includes(x));
            }
            if (ops.includes("EXCLUDE")) {
              next.EXCLUDE = uniq([...next.EXCLUDE, ...items]);
              next.ADD = next.ADD.filter((x) => !next.EXCLUDE.includes(x));
            }
          }
          setIngredientOps(next);

          // 로컬 장바구니에 추가하고 확인 화면으로
          if (!selectedMenu) {
            console.warn("selectedMenu missing");
            setState("ORDER_CONFIRM");
            return;
          }
          setCart((prev) => [
            ...prev,
            {
              menu_id: selectedMenu.id,
              name: selectedMenu.name,
              size_cm: sizeCm,
              quantity: 1,
              ingredients_ops: next,
            },
          ]);
          setState("ORDER_CONFIRM");
        }
        break;

      case "ORDER_CONFIRM":
        if (intent === "ORDER_CONFIRM") {
          if (cart.length === 0) {
            speakKo("담긴 항목이 없습니다.");
            break;
          }
          try {
            // 1) 주문 생성
            const r = await fetch(`${API}/orders`, { method: "POST" });
            const d = await r.json();
            setOrderId(d.order_id);
            const oid = d.order_id as number;

            // 2) 아이템 업로드
            for (const it of cart) {
              await fetch(`${API}/orders/${oid}/items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  menu_id: it.menu_id,
                  quantity: it.quantity,
                  size_cm: it.size_cm,
                  ingredients_ops: it.ingredients_ops,
                }),
              });
            }

            // 3) 영수증 조회
            const rec = await fetch(`${API}/orders/${oid}`).then((r) => r.json());
            setReceipt(rec);

            // 4) 확정
            await fetch(`${API}/orders/${oid}/confirm`, { method: "POST" });

            // 5) 완료
            setCart([]);
            setState("END");
            speakKo("주문이 완료되었습니다. 감사합니다.");
          } catch (e) {
            console.error("order confirm failed", e);
            speakKo("주문에 실패했습니다. 다시 시도해주세요.");
          }
        } else if (intent === "GO_BACK") {
          setState("MAIN_MENU");
        }
        break;
    }
  };

  const goMainMenu = () => setState("MAIN_MENU");

  // -------- Render --------
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              {state !== "START" && state !== "END" && (
                <button onClick={goHome} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <ArrowLeft className="w-5 h-5" />
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
              <p className="text-gray-600 mb-8">마이크 버튼을 누르고 원하는 메뉴를 말씀해주세요</p>
              <button
                onClick={goMainMenu}
                className="bg-green-500 text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-green-600 transition-colors shadow-lg"
              >
                주문 시작하기
              </button>
            </div>
          </div>
        )}

        {/* MAIN_MENU */}
        {state === "MAIN_MENU" && (
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">인기 메뉴</h2>
              <p className="text-gray-600">원하시는 메뉴의 번호를 말씀해주세요</p>
            </div>

            {menusLoading && (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto"></div>
                <p className="mt-4 text-gray-600">메뉴를 불러오는 중...</p>
              </div>
            )}

            {menusError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">{menusError}</div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
              {menus.slice(0, 10).map((m, idx) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setSelectedMenu(m);
                    setState("MENU_DETAIL");
                  }}
                  className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow border border-gray-200 overflow-hidden text-left"
                >
                  <div className="aspect-square bg-gray-100 relative">
                    {m.image_url ? (
                      <img src={m.image_url} alt={m.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">이미지 없음</div>
                    )}
                    <div className="absolute top-2 left-2 bg-green-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">
                      {idx + 1}
                    </div>
                  </div>
                  <div className="p-3">
                    <h3 className="font-semibold text-gray-900 mb-1">{m.name}</h3>
                    <p className="text-sm text-gray-600">
                      {typeof m.price_15_cents === "number"
                        ? `₩${(m.price_15_cents / 100).toLocaleString()}~`
                        : typeof m.price_cents === "number"
                        ? `₩${(m.price_cents / 100).toLocaleString()}`
                        : "가격 정보 없음"}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            <VoiceControl
              isRecording={isRecording}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onTranscribe={() => uploadAndTranscribe()}
              audioURL={audioURL}
              status={status}
              sttText={sttText}
              nluResult={nluResult}
              onTextSubmit={onTextSubmit}
            />
          </div>
        )}

        {/* MENU_DETAIL */}
        {state === "MENU_DETAIL" && selectedMenu && (
          <div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-6">
              <div className="aspect-video bg-gray-100">
                {selectedMenu.image_url ? (
                  <img src={selectedMenu.image_url} alt={selectedMenu.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">이미지 없음</div>
                )}
              </div>
              <div className="p-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">{selectedMenu.name}</h2>
                <p className="text-gray-600 mb-4">{selectedMenu.description}</p>

                <div className="border-t border-gray-200 pt-4">
                  <h3 className="font-semibold text-gray-900 mb-3">사이즈 선택</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setSizeCm(15)}
                      className={`p-4 border-2 rounded-lg transition-all ${
                        sizeCm === 15 ? "border-green-500 bg-green-50" : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="font-semibold text-gray-900">15cm</div>
                      <div className="text-sm text-gray-600">
                        {typeof selectedMenu.price_15_cents === "number"
                          ? `₩${(selectedMenu.price_15_cents / 100).toLocaleString()}`
                          : "-"}
                      </div>
                    </button>
                    <button
                      onClick={() => setSizeCm(30)}
                      className={`p-4 border-2 rounded-lg transition-all ${
                        sizeCm === 30 ? "border-green-500 bg-green-50" : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="font-semibold text-gray-900">30cm</div>
                      <div className="text-sm text-gray-600">
                        {typeof selectedMenu.price_30_cents === "number"
                          ? `₩${(selectedMenu.price_30_cents / 100).toLocaleString()}`
                          : "-"}
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-blue-900">
                💡 "메뉴 설명해줘" - 메뉴 정보 듣기<br />
                💡 "주문하기" - 재료 선택으로 이동<br />
                💡 "이전으로 돌아가" - 메뉴 목록으로
              </p>
            </div>

            <VoiceControl
              isRecording={isRecording}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onTranscribe={() => uploadAndTranscribe()}
              audioURL={audioURL}
              status={status}
              sttText={sttText}
              nluResult={nluResult}
              onTextSubmit={onTextSubmit}
            />
          </div>
        )}

        {/* VEGETABLE_SELECTION */}
        {state === "VEGETABLE_SELECTION" && (
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">재료 선택</h2>
              <p className="text-gray-600">추가하거나 제외할 재료를 말씀해주세요</p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-blue-900">
                💡 "양파 빼고 전부 추가해줘"<br />
                💡 "랜치 소스만 넣어줘"<br />
                💡 "토마토 추가해줘"
              </p>
            </div>

            {ingredients.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                <h3 className="font-semibold text-gray-900 mb-4">사용 가능한 재료</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {ingredients.map((ing) => {
                    const add = ingredientOps.ADD.includes(ing.name);
                    const ex = ingredientOps.EXCLUDE.includes(ing.name);
                    return (
                      <div
                        key={ing.id}
                        className={`p-3 rounded-lg border-2 transition-all ${
                          add ? "border-green-500 bg-green-50"
                          : ex  ? "border-red-500 bg-red-50"
                                : "border-gray-200 bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {add && <Plus className="w-4 h-4 text-green-600" />}
                          {ex && <X className="w-4 h-4 text-red-600" />}
                          <span className="font-medium text-gray-900">{ing.name}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">{ing.type}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(ingredientOps.ADD.length > 0 || ingredientOps.EXCLUDE.length > 0) && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
                <h3 className="font-semibold text-gray-900 mb-2">현재 선택 옵션</h3>
                <div className="space-y-2 text-sm">
                  {ingredientOps.ADD.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-green-600 font-medium">추가:</span>
                      <span className="text-gray-900">{ingredientOps.ADD.join(", ")}</span>
                    </div>
                  )}
                  {ingredientOps.EXCLUDE.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-red-600 font-medium">제외:</span>
                      <span className="text-gray-900">{ingredientOps.EXCLUDE.join(", ")}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <VoiceControl
              isRecording={isRecording}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onTranscribe={() => uploadAndTranscribe()}
              audioURL={audioURL}
              status={status}
              sttText={sttText}
              nluResult={nluResult}
              onTextSubmit={onTextSubmit}
            />
          </div>
        )}

        {/* ORDER_CONFIRM */}
        {state === "ORDER_CONFIRM" && (
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">주문 확인</h2>
              <p className="text-gray-600">주문 내용을 확인하고 결제를 진행해주세요</p>
            </div>

            {/* 서버 영수증(확정 후) */}
            {receipt && (
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
                            {it.ingredients_ops &&
                              (it.ingredients_ops.ADD?.length || it.ingredients_ops.EXCLUDE?.length) && (
                                <div className="text-xs text-gray-500 mt-1">
                                  {it.ingredients_ops.ADD?.length > 0 && `+ ${it.ingredients_ops.ADD.join(", ")}`}
                                  {it.ingredients_ops.EXCLUDE?.length > 0 && ` - ${it.ingredients_ops.EXCLUDE.join(", ")}`}
                                </div>
                              )}
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-gray-900">
                              ₩{(((it.unit_price_cents ?? it.price_cents ?? 0) * it.quantity) / 100).toLocaleString()}
                            </div>
                            <div className="text-sm text-gray-600">
                              ₩{((it.unit_price_cents ?? it.price_cents ?? 0) / 100).toLocaleString()} × {it.quantity}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                          <div className="flex items-center border border-gray-300 rounded-lg">
                            <button
                              onClick={() => {
                                fetch(`${API}/orders/${orderId}/items/${it.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ op: "dec", delta: 1 }),
                                }).then(() =>
                                  fetch(`${API}/orders/${orderId}`).then((r) => r.json()).then(setReceipt)
                                );
                              }}
                              className="p-2 hover:bg-gray-100 transition-colors"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <span className="px-4 font-medium">{it.quantity}</span>
                            <button
                              onClick={() => {
                                fetch(`${API}/orders/${orderId}/items/${it.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ op: "inc", delta: 1 }),
                                }).then(() =>
                                  fetch(`${API}/orders/${orderId}`).then((r) => r.json()).then(setReceipt)
                                );
                              }}
                              className="p-2 hover:bg-gray-100 transition-colors"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                          <button
                            onClick={() => {
                              fetch(`${API}/orders/${orderId}/items/${it.id}`, { method: "DELETE" }).then(() =>
                                fetch(`${API}/orders/${orderId}`).then((r) => r.json()).then(setReceipt)
                              );
                            }}
                            className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">장바구니가 비어있습니다</p>
                )}

                <div className="border-t border-gray-200 mt-6 pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-semibold text-gray-900">총 결제금액</span>
                    <span className="text-2xl font-bold text-green-600">₩{(receipt.total_cents / 100).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}

            {/* 로컬 장바구니(확정 전 미리보기) */}
            {!receipt && cart.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                <h3 className="font-semibold text-gray-900 mb-4 pb-3 border-b border-gray-200">장바구니(임시)</h3>
                <ul className="space-y-2">
                  {cart.map((it, i) => (
                    <li key={i} className="flex justify-between">
                      <div>
                        <span className="font-medium">{it.name}</span>{" "}
                        <span className="text-gray-600">({it.size_cm}cm)</span> × {it.quantity}
                        {(it.ingredients_ops.ADD.length || it.ingredients_ops.EXCLUDE.length) && (
                          <div className="text-xs text-gray-500">
                            {it.ingredients_ops.ADD.length ? ` +${it.ingredients_ops.ADD.join(", ")}` : ""}
                            {it.ingredients_ops.EXCLUDE.length ? ` -${it.ingredients_ops.EXCLUDE.join(", ")}` : ""}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-blue-900">
                💡 "주문하기" - 주문 완료<br />
                💡 "추가 주문" - 메뉴 선택으로 돌아가기<br />
                💡 "취소" - 주문 취소
              </p>
            </div>

            <div className="flex gap-3 mb-6">
              <button
                onClick={() => setState("MAIN_MENU")}
                className="flex-1 bg-white text-gray-900 border-2 border-gray-300 px-6 py-4 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
              >
                추가 주문
              </button>
              <button
                onClick={async () => {
                  if (cart.length === 0) {
                    speakKo("담긴 항목이 없습니다.");
                    return;
                  }
                  try {
                    const r = await fetch(`${API}/orders`, { method: "POST" });
                    const d = await r.json();
                    setOrderId(d.order_id);
                    const oid = d.order_id as number;

                    for (const it of cart) {
                      await fetch(`${API}/orders/${oid}/items`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          menu_id: it.menu_id,
                          quantity: it.quantity,
                          size_cm: it.size_cm,
                          ingredients_ops: it.ingredients_ops,
                        }),
                      });
                    }
                    const rec = await fetch(`${API}/orders/${oid}`).then((r) => r.json());
                    setReceipt(rec);
                    await fetch(`${API}/orders/${oid}/confirm`, { method: "POST" });

                    setCart([]);
                    setState("END");
                    speakKo("주문이 완료되었습니다. 감사합니다.");
                  } catch (e) {
                    console.error("confirm failed", e);
                    speakKo("주문에 실패했습니다. 다시 시도해주세요.");
                  }
                }}
                className="flex-1 bg-green-500 text-white px-6 py-4 rounded-lg font-semibold hover:bg-green-600 transition-colors shadow-lg"
              >
                {receipt?.total_cents ? `₩${(receipt.total_cents / 100).toLocaleString()} 결제하기` : "주문 확정"}
              </button>
            </div>

            <VoiceControl
              isRecording={isRecording}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onTranscribe={() => uploadAndTranscribe()}
              audioURL={audioURL}
              status={status}
              sttText={sttText}
              nluResult={nluResult}
              onTextSubmit={onTextSubmit}
            />
          </div>
        )}

        {/* END */}
        {state === "END" && (
          <div className="flex flex-col items-center justify-center min-h-[70vh]">
            <div className="text-center">
              <div className="w-32 h-32 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-8">
                <Check className="w-16 h-16 text-white" />
              </div>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">주문이 완료되었습니다</h2>
              <p className="text-gray-600 mb-2">감사합니다!</p>
              {receipt && (
                <p className="text-xl font-semibold text-green-600 mb-8">
                  결제 금액: ₩{(receipt.total_cents / 100).toLocaleString()}
                </p>
              )}
              <button
                onClick={goHome}
                className="bg-green-500 text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-green-600 transition-colors shadow-lg"
              >
                처음으로 돌아가기
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function VoiceControl({
  isRecording,
  onStartRecording,
  onStopRecording,
  onTranscribe,
  audioURL,
  status,
  sttText,
  nluResult,
  onTextSubmit,     // ★ 추가된 prop
}: {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onTranscribe: () => void;
  audioURL: string;
  status: string;
  sttText: string;
  nluResult: any;
  onTextSubmit: (text: string) => void;  // ★ 타입 선언
}) {
  const [textCmd, setTextCmd] = useState("");

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h3 className="font-semibold text-gray-900 mb-4">음성 입력</h3>

      <div className="flex items-center gap-3 mb-4">
        {!isRecording ? (
          <button
            onClick={onStartRecording}
            className="flex items-center gap-2 bg-green-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-green-600 transition-colors shadow-md"
          >
            <Mic className="w-5 h-5" /> 녹음 시작
          </button>
        ) : (
          <button
            onClick={onStopRecording}
            className="flex items-center gap-2 bg-red-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-red-600 transition-colors shadow-md animate-pulse"
          >
            <MicOff className="w-5 h-5" /> 녹음 중지
          </button>
        )}

        <button
          onClick={onTranscribe}
          disabled={!audioURL}
          className="flex items-center gap-2 bg-blue-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          음성 인식
        </button>

        <div className="flex-1 text-sm text-gray-600">
          상태: <span className="font-medium">{status}</span>
        </div>
      </div>

      {/* 텍스트 명령 테스트 UI */}
      <div className="mt-4 border-t border-gray-200 pt-4">
        <h4 className="text-sm font-semibold text-gray-900 mb-2">텍스트로 테스트</h4>
        <div className="flex gap-2">
          <input
            value={textCmd}
            onChange={(e) => setTextCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onTextSubmit(textCmd);
                setTextCmd("");
              }
            }}
            placeholder='예: "3번", "주문하기", "양파 빼고 전부 추가해줘", "취소", "예"'
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            onClick={() => {
              onTextSubmit(textCmd);
              setTextCmd("");
            }}
            className="bg-blue-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-600 transition-colors"
          >
            실행
          </button>
        </div>
      </div>

      {status.startsWith("error:") && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-red-800">{status}</p>
          <button onClick={onTranscribe} className="mt-2 text-sm text-red-600 underline hover:text-red-800">
            다시 시도
          </button>
        </div>
      )}

      {audioURL && (
        <div className="mb-4">
          <audio src={audioURL} controls className="w-full" />
        </div>
      )}

      {sttText && (
        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">인식된 텍스트</h4>
          <p className="text-gray-900">{sttText}</p>
        </div>
      )}

      {nluResult && (
        <div className="bg-blue-50 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">NLU 분석 결과</h4>
          <div className="text-sm space-y-1">
            <div>
              <span className="text-blue-700 font-medium">의도:</span>{" "}
              <span className="text-blue-900">{nluResult.intent}</span>
            </div>
            {nluResult.confidence !== undefined && (
              <div>
                <span className="text-blue-700 font-medium">신뢰도:</span>{" "}
                <span className="text-blue-900">{(nluResult.confidence * 100).toFixed(0)}%</span>
              </div>
            )}
            {nluResult.slots && Object.keys(nluResult.slots).length > 0 && (
              <div>
                <span className="text-blue-700 font-medium">슬롯:</span>
                <pre className="mt-1 text-xs text-blue-900 overflow-auto">{JSON.stringify(nluResult.slots, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
