"use client";

import { useRef, useState } from "react";
import { useEffect } from "react";


type Menu = {
  id: number;
  name: string;
  description: string;
  image_url: string;
  price_cents: number;
  popular_rank: number;
};



type KioskState =
  | "START"
  | "MAIN_MENU"
  | "MENU_DETAIL"
  | "VEGETABLE_SELECTION"
  | "ORDER_CONFIRM"
  | "END";

function speakKo(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  // 필요시 속도/피치 조절
  u.rate = 1.0; u.pitch = 1.0;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export default function Page() {
  // ---- UI / STT ----
  const [isRecording, setIsRecording] = useState(false);
  const [audioURL, setAudioURL] = useState<string>("");
  const [sttText, setSttText] = useState<string>("");
  const [status, setStatus] = useState<string>("idle");

  const [menus, setMenus] = useState<Menu[]>([]);
  const [menusLoading, setMenusLoading] = useState(false);
  const [menusError, setMenusError] = useState<string | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // ---- State Machine ----
  const [state, setState] = useState<KioskState>("START");
  // ---- NLU 처리 ----
  const [nluResult, setNluResult] = useState<any>(null);


  useEffect(() => {
    switch (state) {
      case "START":
        speakKo("음성으로 주문하려면 버튼을 눌러주세요.");
        break;
      case "MAIN_MENU":
        speakKo("원하는 메뉴의 번호를 말씀해주세요.");
        break;
      case "MENU_DETAIL":
        speakKo("메뉴 설명을 듣고 싶으면 메뉴 설명해줘, 주`문하려면 주문하기 라고 말해주세요.");
        break;
      case "VEGETABLE_SELECTION":
        speakKo("예시: 양파 빼고 전부 추가해줘, 렌치 소스만 넣어줘.");
        break;
      case "ORDER_CONFIRM":
        speakKo("주문 완료하시겠습니까? 주문하기, 추가 주문, 또는 취소라고 말씀해주세요.");
        break;
      case "END":
        speakKo("주문이 완료되었습니다. 감사합니다.");
        break;
    }
  }, [state]);

  useEffect(() => {
    if (state !== "MAIN_MENU") return;
    setMenusLoading(true);
    setMenusError(null);

    fetch("http://localhost:8000/menus/popular")
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


  useEffect(() => {
  if (state !== "MAIN_MENU") return;
  fetch("http://localhost:8000/menus/popular")
    .then(res => res.json())
    .then(setMenus)
    .catch(() => setMenus([]));
  }, [state]);


  const preferredTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];

  const startRecording = async () => {
    setSttText("");
    setStatus("requesting mic...");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    let mimeType = "";
    for (const t of preferredTypes) {
      if ((MediaRecorder as any).isTypeSupported?.(t)) { mimeType = t; break; }
    }

    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = mr;
    chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      setAudioURL(URL.createObjectURL(blob));
      setStatus(`recorded ${Math.round(blob.size/1024)} KB`);
    };
    mr.start();
    setIsRecording(true);
    setStatus("recording...");
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.stop();
      mr.stream.getTracks().forEach(t => t.stop());
      setIsRecording(false);
      setStatus("stopped");
    }
  };

  const goHome = () => {
    // 녹음중이면 안전하게 중지
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.stop();
      mr.stream.getTracks().forEach(t => t.stop());
      setIsRecording(false);
    }

    // 음성합성도 정리(중복 안내 방지)
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    // 화면/상태 초기화
    setAudioURL("");
    setSttText("");
    setNluResult(null);
    setStatus("idle");

    // 시작 화면으로
    setState("START");
  };

  const uploadAndTranscribe = async () => {
    if (!audioURL) return alert("먼저 녹음하세요.");
    setStatus("transcribing...");
    setSttText("");

    const blob = await fetch(audioURL).then(r => r.blob());
    const ext =
      blob.type.includes("webm") ? "webm" :
      blob.type.includes("mp4")  ? "mp4"  :
      blob.type.includes("m4a")  ? "m4a"  : "webm";

    const fd = new FormData();
    fd.append("file", blob, `record.${ext}`);

    const resp = await fetch("http://localhost:8000/transcribe", { method: "POST", body: fd });
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

   
    // ---- NLU 호출 (룰 기반 1차) ----
    const nluRes = await fetch("http://localhost:8000/nlu", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ text: data.text, context: state }),
    });
    const nlu = await nluRes.json();
    setNluResult(nlu);   
    console.log("[NLU]", nlu);
    handleIntent(nlu.intent, nlu.slots);

  };

  const handleIntent = (intent: string, slots: any) => {
    switch (state) {
      case "START":
        // START에서는 버튼으로 MAIN_MENU 진입 가정
        break;
      case "MAIN_MENU":
        if (intent === "SELECT_MENU") {
          // slots.menu_number 이용 -> 메뉴 상세로
          setState("MENU_DETAIL");
        }
        break;
      case "MENU_DETAIL":
        if (intent === "READ_MENU_DESC") {
          // TTS는 추후(브라우저 SpeechSynthesis 또는 서버 TTS)
          console.log("메뉴 설명 읽기");
        } else if (intent === "ORDER_CONFIRM") {
          setState("VEGETABLE_SELECTION");
        } else if (intent === "GO_BACK") {
          setState("MAIN_MENU");
        }
        break;
      case "VEGETABLE_SELECTION":
        if (intent === "SET_INGREDIENTS") {
          console.log("ING OPS:", slots);
          setState("ORDER_CONFIRM");
        }
        break;
      case "ORDER_CONFIRM":
        if (intent === "ORDER_CONFIRM") {
          setState("END");
        } else if (intent === "GO_BACK") {
          setState("MAIN_MENU");
        }
        break;
      default:
        break;
    }
  };

  const goMainMenu = () => setState("MAIN_MENU");

  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      {/* --------- START --------- */}
      {state === "START" && (
        <>
          <h1>키오스크 대기</h1>
          <div style={{ fontSize: 48, fontWeight: 700 }}>LOGO</div>
          <button onClick={goMainMenu} style={{ padding: "12px 24px" }}>
            음성으로 주문하기
          </button>
        </>
      )}

      {/* --------- MAIN_MENU --------- */}
      {state === "MAIN_MENU" && (
        <>
          <h2>인기 메뉴</h2>

          {menusLoading && <p>메뉴 불러오는 중...</p>}
          {menusError && <p style={{ color: "crimson" }}>{menusError}</p>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 160px)", gap: 12 }}>
            {[1,2,3].map(n => (
              <div key={n} style={{ border:"1px solid #ddd", padding:8, borderRadius:8 }}>
                <div style={{ height: 90, background:"#f4f4f4" }}>[이미지]</div>
                <div style={{ marginTop: 8, fontWeight:600 }}>{n}번</div>
              </div>
            ))}
          </div>

          <p style={{ marginTop: 12 }}>&quot;원하는 메뉴의 번호를 말씀해주세요.&quot;</p>

          <div style={{ display:"flex", gap:8 }}>
            {!isRecording ? (
              <button onClick={startRecording}>녹음 시작</button>
            ) : (
              <button onClick={stopRecording}>녹음 정지</button>
            )}
            <button onClick={uploadAndTranscribe} disabled={!audioURL}>전사 요청</button>
            <span>status: {status}</span>
          </div>

          {status.startsWith("error:") && (
            <div style={{color: "crimson"}}>
              {status} <button onClick={uploadAndTranscribe}>다시 시도</button>
            </div>
          )}

          {audioURL && <audio src={audioURL} controls style={{ width: 300 }} />}

          {sttText && (
            <div>
              <h4>STT 결과</h4>
              <pre>{sttText}</pre>
            </div>
          )}
        {nluResult && (
          <div>
            <h4>NLU 결과</h4>
            <pre>{JSON.stringify(nluResult, null, 2)}</pre>
          </div>
        )}
        <p>현재 상태: <b>{state}</b></p>
        </>
      )}

      {/* --------- MENU_DETAIL --------- */}
      {state === "MENU_DETAIL" && (
        <>
          <h2>메뉴 상세</h2>
          <div style={{ height: 140, background:"#f4f4f4", marginBottom:8 }}>[선택 메뉴 이미지]</div>
          <p>“메뉴 설명을 듣고 싶으면 ‘메뉴 설명해줘’. 주문을 원하시면 ‘주문하기’. 이전은 ‘이전으로 돌아가’.”</p>
          <div style={{ display:"flex", gap:8 }}>
            {!isRecording ? <button onClick={startRecording}>녹음</button> : <button onClick={stopRecording}>정지</button>}
            <button onClick={uploadAndTranscribe} disabled={!audioURL}>전사 요청</button>
          </div>

          {status.startsWith("error:") && (
            <div style={{color: "crimson"}}>
              {status} <button onClick={uploadAndTranscribe}>다시 시도</button>
            </div>
          )}

          {sttText && <pre>{sttText}</pre>}

          {nluResult && (
          <div>
            <h4>NLU 결과</h4>
            <pre>{JSON.stringify(nluResult, null, 2)}</pre>
          </div>
          )}
          <p>현재 상태: <b>{state}</b></p>
        </>
      )}

      {/* --------- VEGETABLE_SELECTION --------- */}
      {state === "VEGETABLE_SELECTION" && (
        <>
          <h2>재료 선택</h2>
          <p>예시: “양파 빼고 전부 추가해줘 / 렌치 소스만 넣어줘”</p>
          <div style={{ display:"flex", gap:8 }}>
            {!isRecording ? <button onClick={startRecording}>녹음</button> : <button onClick={stopRecording}>정지</button>}
            <button onClick={uploadAndTranscribe} disabled={!audioURL}>전사 요청</button>
          </div>

          {status.startsWith("error:") && (
            <div style={{color: "crimson"}}>
              {status} <button onClick={uploadAndTranscribe}>다시 시도</button>
            </div>
          )}

          {sttText && <pre>{sttText}</pre>}

          {nluResult && (
          <div>
            <h4>NLU 결과</h4>
            <pre>{JSON.stringify(nluResult, null, 2)}</pre>
          </div>
          )}
          <p>현재 상태: <b>{state}</b></p>          
        </>
      )}

      {/* --------- ORDER_CONFIRM --------- */}
      {state === "ORDER_CONFIRM" && (
        <>
          <h2>주문 확인</h2>
          <p>“주문 완료하시겠습니까?” → “주문하기 / 추가 주문 / 취소”</p>
          <div style={{ display:"flex", gap:8 }}>
            {!isRecording ? <button onClick={startRecording}>녹음</button> : <button onClick={stopRecording}>정지</button>}
            <button onClick={uploadAndTranscribe} disabled={!audioURL}>전사 요청</button>
          </div>

          {status.startsWith("error:") && (
            <div style={{color: "crimson"}}>
              {status} <button onClick={uploadAndTranscribe}>다시 시도</button>
            </div>
          )}

          {sttText && <pre>{sttText}</pre>}

          {nluResult && (
          <div>
            <h4>NLU 결과</h4>
            <pre>{JSON.stringify(nluResult, null, 2)}</pre>
          </div>
          )}
          <p>현재 상태: <b>{state}</b></p>
        </>
      )}

      {/* --------- END --------- */}
      {state === "END" && (
        <>
          <h2>주문이 완료되었습니다. 감사합니다.</h2>
          <button onClick={goHome} style={{ marginTop: 12, padding: "8px 16px" }}>
            처음으로
          </button>
        </>
      )}
    </main>
  );
}
