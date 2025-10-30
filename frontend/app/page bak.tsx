"use client";

import { useEffect, useRef, useState } from "react";

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

function speakKo(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = 1.0; u.pitch = 1.0;
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
  const [orderId, setOrderId] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [sizeCm, setSizeCm] = useState<15 | 30>(15);

  // 재료 선택(음성 파싱 누적)
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
        speakKo("음성으로 주문하려면 버튼을 눌러주세요."); break;
      case "MAIN_MENU":
        speakKo("원하는 메뉴의 번호를 말씀해주세요."); break;
      case "MENU_DETAIL":
        speakKo("메뉴 설명을 듣고 싶으면 메뉴 설명해줘, 주문하려면 주문하기 라고 말해주세요."); break;
      case "VEGETABLE_SELECTION":
        speakKo("예시: 양파 빼고 전부 추가해줘, 렌치 소스만 넣어줘."); break;
      case "ORDER_CONFIRM":
        speakKo("주문 완료하시겠습니까? 주문하기, 추가 주문, 또는 취소라고 말씀해주세요."); break;
      case "END":
        speakKo("주문이 완료되었습니다. 감사합니다."); break;
    }
  }, [state]);

  // MAIN_MENU: 메뉴 로드 + 새 주문 생성 + 상태 초기화
  useEffect(() => {
    if (state !== "MAIN_MENU") return;

    setSelectedMenu(null);
    setReceipt(null);
    setIngredientOps({ ADD: [], EXCLUDE: [] });

    setMenusLoading(true);
    setMenusError(null);
    fetch(`${API}/menus/popular`)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((data: Menu[]) => setMenus(data))
      .catch((err) => { console.error(err); setMenusError("인기 메뉴 조회에 실패했습니다."); setMenus([]); })
      .finally(() => setMenusLoading(false));

    fetch(`${API}/orders`, { method: "POST" })
      .then((res) => res.json())
      .then((d) => setOrderId(d.order_id))
      .catch((err) => console.error("create order failed", err));
  }, [state]);

  // VEGETABLE_SELECTION: DB 재료 목록 로드 (한 번만 필요하면 캐시 조건 추가 가능)
  useEffect(() => {
    if (state !== "VEGETABLE_SELECTION") return;
    fetch(`${API}/ingredients`)
      .then((res) => res.json())
      .then((rows: Ingredient[]) => setIngredients(rows))
      .catch((err) => { console.error("load ingredients failed", err); setIngredients([]); });
  }, [state]);

  // ORDER_CONFIRM: 영수증
  useEffect(() => {
    if (state !== "ORDER_CONFIRM" || !orderId) return;
    fetch(`${API}/orders/${orderId}`)
      .then((res) => res.json())
      .then(setReceipt)
      .catch((err) => { console.error("get receipt failed", err); setReceipt(null); });
  }, [state, orderId]);

  // -------- Recording --------
  const preferredTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  const startRecording = async () => {
    setSttText(""); setStatus("requesting mic...");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let mimeType = "";
    for (const t of preferredTypes) if ((MediaRecorder as any).isTypeSupported?.(t)) { mimeType = t; break; }
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = mr; chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      setAudioURL(URL.createObjectURL(blob));
      setStatus(`recorded ${Math.round(blob.size / 1024)} KB`);
    };
    mr.start(); setIsRecording(true); setStatus("recording...");
  };
  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.stop(); mr.stream.getTracks().forEach((t) => t.stop());
      setIsRecording(false); setStatus("stopped");
    }
  };

  const goHome = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") { mr.stop(); mr.stream.getTracks().forEach((t) => t.stop()); setIsRecording(false); }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setAudioURL(""); setSttText(""); setNluResult(null); setStatus("idle"); setSizeCm(15); setState("START");
  };

  // -------- STT → NLU --------
  const uploadAndTranscribe = async () => {
    if (!audioURL) return alert("먼저 녹음하세요.");
    setStatus("transcribing..."); setSttText("");

    const blob = await fetch(audioURL).then((r) => r.blob());
    const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("mp4") ? "mp4" : blob.type.includes("m4a") ? "m4a" : "webm";
    const fd = new FormData(); fd.append("file", blob, `record.${ext}`);

    const resp = await fetch(`${API}/transcribe`, { method: "POST", body: fd });
    if (!resp.ok) { const t = await resp.text(); console.error("Transcribe failed", resp.status, t); setStatus(`error: transcribe failed ${resp.status}`); return; }
    const data = await resp.json();
    if (!data.text || data.text.trim().length === 0) { setStatus("error: empty transcription result"); return; }
    setSttText(data.text); setStatus("transcribed");

    const knownNames = ingredients.length
      ? ingredients.map((i) => i.name)
      : ["양파","할라피뇨","피클","토마토","올리브","렌치","머스타드","마요","스위트어니언"]; // fallback

    const nluEndpoint = USE_LLM_NLU ? `${API}/nlu_llm` : `${API}/nlu`;
    const body = USE_LLM_NLU
      ? { text: data.text, context: state, menu_count: menus.length || 10, known_ingredients: knownNames }
      : { text: data.text, context: state };

    const nluRes = await fetch(nluEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const nlu = await nluRes.json();
    setNluResult(nlu); console.log("[NLU]", nlu);
    handleIntent(nlu.intent, nlu.slots);
  };

  // -------- Intent Handler --------
  const handleIntent = (intent: string, slots: any) => {
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
          console.log("메뉴 설명 읽기");
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

          // ONLY: 해당 items만 ADD로 설정, EXCLUDE 리셋
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

          // 옵션 확정되면 아이템 추가 → ORDER_CONFIRM
          if (!orderId || !selectedMenu) {
            console.warn("orderId or selectedMenu missing");
            setState("ORDER_CONFIRM");
            return;
          }
          fetch(`${API}/orders/${orderId}/items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ menu_id: selectedMenu.id, quantity: 1, size_cm: sizeCm, ingredients_ops: next }),
          })
            .then((res) => res.json())
            .then(() => setState("ORDER_CONFIRM"))
            .catch((err) => { console.error("add item failed", err); setState("ORDER_CONFIRM"); });
        }
        break;

      case "ORDER_CONFIRM":
        if (intent === "ORDER_CONFIRM") {
          if (!orderId) break;
          fetch(`${API}/orders/${orderId}/confirm`, { method: "POST" })
            .then(() => setState("END"))
            .catch((err) => console.error("confirm failed", err));
        } else if (intent === "GO_BACK") {
          setState("MAIN_MENU");
        }
        break;
    }
  };

  const goMainMenu = () => setState("MAIN_MENU");

  // -------- Render --------
  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      {/* START */}
      {state === "START" && (
        <>
          <h1>키오스크 대기</h1>
          <div style={{ fontSize: 48, fontWeight: 700 }}>LOGO</div>
          <button onClick={goMainMenu} style={{ padding: "12px 24px" }}>음성으로 주문하기</button>
        </>
      )}

      {/* MAIN_MENU */}
      {state === "MAIN_MENU" && (
        <>
          <h2>인기 메뉴</h2>
          {menusLoading && <p>메뉴 불러오는 중...</p>}
          {menusError && <p style={{ color: "crimson" }}>{menusError}</p>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 160px)", gap: 12 }}>
            {menus.slice(0, 10).map((m, idx) => (
              <button key={m.id} onClick={() => { setSelectedMenu(m); setState("MENU_DETAIL"); }}
                style={{ border: "1px solid #ddd", padding: 8, borderRadius: 8, textAlign: "left", background: "white", cursor: "pointer" }}>
                <div style={{ height: 90, background: "#f4f4f4" }}>
                  {m.image_url ? <img src={m.image_url} alt={m.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "[이미지]"}
                </div>
                <div style={{ marginTop: 8, fontWeight: 600 }}>{idx + 1}번 {m.name}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  {typeof m.price_15_cents === "number"
                  ? `₩${(m.price_15_cents/100).toLocaleString()} (15cm)`
                  : (typeof m.price_cents === "number"
                    ? `₩${(m.price_cents/100).toLocaleString()}`
                    : "가격 정보 없음")}
                </div>
              </button>
            ))}
          </div>

          <p style={{ marginTop: 12 }}>&quot;원하는 메뉴의 번호를 말씀해주세요.&quot;</p>

          <div style={{ display: "flex", gap: 8 }}>
            {!isRecording ? (<button onClick={startRecording}>녹음 시작</button>) : (<button onClick={stopRecording}>녹음 정지</button>)}
            <button onClick={uploadAndTranscribe} disabled={!audioURL}>전사 요청</button>
            <span>status: {status}</span>
          </div>

          {status.startsWith("error:") && (<div style={{ color: "crimson" }}>{status} <button onClick={uploadAndTranscribe}>다시 시도</button></div>)}
          {audioURL && <audio src={audioURL} controls style={{ width: 300 }} />}
          {sttText && (<div><h4>STT 결과</h4><pre>{sttText}</pre></div>)}
          {nluResult && (<div><h4>NLU 결과</h4><pre>{JSON.stringify(nluResult, null, 2)}</pre></div>)}
          <p>현재 상태: <b>{state}</b> {orderId ? `| orderId: ${orderId}` : ""}</p>
        </>
      )}

      {/* MENU_DETAIL */}
      {state === "MENU_DETAIL" && (
        <>
          <h2>메뉴 상세</h2>
          <div style={{ height: 140, background: "#f4f4f4", marginBottom: 8 }}>
            {selectedMenu?.image_url ? (
              <img src={selectedMenu.image_url} alt={selectedMenu.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : "[선택 메뉴 이미지]"}
          </div>
          <h3>{selectedMenu?.name ?? "메뉴"}</h3>
          <p style={{ color: "#666" }}>{selectedMenu?.description ?? ""}</p>
          <div style={{ marginTop: 8 }}>
          <label><input type="radio" checked={sizeCm===15} onChange={()=>setSizeCm(15)} /> 15cm</label>
          &nbsp;&nbsp;
          <label><input type="radio" checked={sizeCm===30} onChange={()=>setSizeCm(30)} /> 30cm</label>
          </div>
          <p>“메뉴 설명을 듣고 싶으면 ‘메뉴 설명해줘’. 주문을 원하시면 ‘주문하기’. 이전은 ‘이전으로 돌아가’.”</p>

          <div style={{ display: "flex", gap: 8 }}>
            {!isRecording ? <button onClick={startRecording}>녹음</button> : <button onClick={stopRecording}>정지</button>}
            <button onClick={uploadAndTranscribe} disabled={!audioURL}>전사 요청</button>
          </div>

          {status.startsWith("error:") && (<div style={{ color: "crimson" }}>{status} <button onClick={uploadAndTranscribe}>다시 시도</button></div>)}
          {sttText && <pre>{sttText}</pre>}
          {nluResult && (<div><h4>NLU 결과</h4><pre>{JSON.stringify(nluResult, null, 2)}</pre></div>)}
          <p>현재 상태: <b>{state}</b></p>
        </>
      )}

      {/* VEGETABLE_SELECTION */}
      {state === "VEGETABLE_SELECTION" && (
        <>
          <h2>재료 선택</h2>
          <p>예시: “양파 빼고 전부 추가해줘 / 렌치 소스만 넣어줘”</p>

          {/* DB 재료 목록 그리드 (상태 시각화) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 160px)", gap: 8, marginTop: 8 }}>
            {ingredients.map((ing) => {
              const add = ingredientOps.ADD.includes(ing.name);
              const ex  = ingredientOps.EXCLUDE.includes(ing.name);
              const bg  = add ? "#e6ffed" : ex ? "#ffecec" : "#f5f5f5";
              const bd  = add ? "1px solid #2ecc71" : ex ? "1px solid #e74c3c" : "1px solid #ddd";
              return (
                <div key={ing.id} style={{ padding: 8, borderRadius: 8, background: bg, border: bd }}>
                  <div style={{ fontWeight: 600 }}>{ing.name}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>{ing.type}</div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {!isRecording ? <button onClick={startRecording}>녹음</button> : <button onClick={stopRecording}>정지</button>}
            <button onClick={uploadAndTranscribe} disabled={!audioURL}>전사 요청</button>
          </div>

          {/* 현재 누적 옵션 미리보기 */}
          <div style={{ border: "1px dashed #ccc", padding: 8, borderRadius: 8, marginTop: 8 }}>
            <div>현재 선택 옵션</div>
            <div style={{ fontSize: 13, color: "#555" }}>
              {ingredientOps.ADD.length ? `+ ${ingredientOps.ADD.join(", ")}` : ""}
              {ingredientOps.EXCLUDE.length ? `  - ${ingredientOps.EXCLUDE.join(", ")}` : ""}
              {(!ingredientOps.ADD.length && !ingredientOps.EXCLUDE.length) ? " (없음)" : ""}
            </div>
          </div>

          {status.startsWith("error:") && (<div style={{ color: "crimson" }}>{status} <button onClick={uploadAndTranscribe}>다시 시도</button></div>)}
          {sttText && <pre>{sttText}</pre>}
          {nluResult && (<div><h4>NLU 결과</h4><pre>{JSON.stringify(nluResult, null, 2)}</pre></div>)}
          <p>현재 상태: <b>{state}</b></p>
        </>
      )}

      {/* ORDER_CONFIRM */}
      {state === "ORDER_CONFIRM" && (
        <>
          <h2>주문 확인</h2>
          <p>“주문 완료하시겠습니까?” → “주문하기 / 추가 주문 / 취소”</p>

          <div style={{ display: "flex", gap: 8 }}>
            {!isRecording ? <button onClick={startRecording}>녹음</button> : <button onClick={stopRecording}>정지</button>}
            <button onClick={uploadAndTranscribe} disabled={!audioURL}>전사 요청</button>
            <button onClick={() => { if (!orderId) return;
              fetch(`${API}/orders/${orderId}/confirm`, { method: "POST" })
                .then(() => setState("END"))
                .catch((err) => console.error("confirm failed", err));
            }}>주문 확정</button>
          </div>

          {receipt && (
            <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8, marginTop: 8 }}>
              <h3>영수증</h3>
              <ul>
                {Array.isArray(receipt?.items) && receipt.items.map((it: any) => (
                  <li key={it.id} style={{ marginBottom: 6 }}>
                    {it.name} ({it.size_cm ?? 15}cm) × {it.quantity}
                    &nbsp;—&nbsp;₩{(((it.unit_price_cents ?? it.price_cents ?? 0))/100).toLocaleString()}
                    <div style={{display:"inline-flex",gap:4,marginLeft:8}}>
                      <button onClick={() => {
                        fetch(`${API}/orders/${orderId}/items/${it.id}`, {method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({op:"dec",delta:1})})
                          .then(()=>fetch(`${API}/orders/${orderId}`).then(r=>r.json()).then(setReceipt));
                      }}>−</button>
                      <span>{it.quantity}</span>
                      <button onClick={() => {
                        fetch(`${API}/orders/${orderId}/items/${it.id}`, {method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({op:"inc",delta:1})})
                        .then(()=>fetch(`${API}/orders/${orderId}`).then(r=>r.json()).then(setReceipt));
                      }}>＋</button>
                      <button onClick={() => {
                        fetch(`${API}/orders/${orderId}/items/${it.id}`, {method:"DELETE"})
                          .then(()=>fetch(`${API}/orders/${orderId}`).then(r=>r.json()).then(setReceipt));
                      }}>삭제</button>
                    </div>
                    {it.ingredients_ops && (it.ingredients_ops.ADD?.length || it.ingredients_ops.EXCLUDE?.length) ? (
                      <div style={{ fontSize: 12, color: "#555" }}>
                        {it.ingredients_ops.ADD?.length ? ` +${it.ingredients_ops.ADD.join(", ")}` : ""}
                        {it.ingredients_ops.EXCLUDE?.length ? ` -${it.ingredients_ops.EXCLUDE.join(", ")}` : ""}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div style={{ fontWeight: 700 }}>합계: ₩{(receipt.total_cents / 100).toLocaleString()}</div>
            </div>
          )}

          {status.startsWith("error:") && (<div style={{ color: "crimson" }}>{status} <button onClick={uploadAndTranscribe}>다시 시도</button></div>)}
          {sttText && <pre>{sttText}</pre>}
          {nluResult && (<div><h4>NLU 결과</h4><pre>{JSON.stringify(nluResult, null, 2)}</pre></div>)}
          <p>현재 상태: <b>{state}</b> {orderId ? `| orderId: ${orderId}` : ""}</p>
        </>
      )}

      {/* END */}
      {state === "END" && (
        <>
          <h2>주문이 완료되었습니다. 감사합니다.</h2>
          <button onClick={goHome} style={{ marginTop: 12, padding: "8px 16px" }}>처음으로</button>
        </>
      )}
    </main>
  );
}
