"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

type MenuItem = { id: number; name: string; desc: string; image: string };
type Slots = {
  main?: string;
  size?: string;
  bread?: string;
  cheese?: string;
  veggies: string[];
  sauces: string[];
  exclude: string[];
  low_confidence?: Record<string, any>;
};

const API = "http://127.0.0.1:8000";

/** ---------- ① 무음 감지 녹음(정적이 minMs 이상 지속되면 stop) ---------- **/
async function recordUntilSilence({
  minMs = 900,
  maxMs = 6000,
  silenceDb = -52,
} = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);

  const recorder = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  let start = performance.now();
  let silentStart = -1;
  const pcm = new Float32Array(analyser.fftSize);

  const tick = () => {
    analyser.getFloatTimeDomainData(pcm);
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
    const rms = Math.sqrt(sum / pcm.length);
    const db = 20 * Math.log10(rms || 1e-8);
    const now = performance.now();

    if (db < silenceDb) {
      if (silentStart < 0) silentStart = now;
    } else {
      silentStart = -1;
    }

    if ((silentStart > 0 && now - silentStart > minMs) || now - start > maxMs) {
      recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      return;
    }
    requestAnimationFrame(tick);
  };

  recorder.start();
  requestAnimationFrame(tick);

  return await new Promise<Blob>((res) => {
    recorder.onstop = () => res(new Blob(chunks, { type: "audio/webm" }));
  });
}

/** ---------- ② 슬롯 머지(부족한 것만 채우기 / 배열은 합집합) ---------- **/
function mergeSlots(prev: Slots | null, next: Slots): Slots {
  const out: Slots = {
    main: next.main || prev?.main,
    size: next.size || prev?.size,
    bread: next.bread || prev?.bread,
    cheese: next.cheese || prev?.cheese,
    veggies: Array.from(
      new Set([...(prev?.veggies || []), ...(next.veggies || [])])
    ),
    sauces: Array.from(
      new Set([...(prev?.sauces || []), ...(next.sauces || [])])
    ),
    exclude: Array.from(
      new Set([...(prev?.exclude || []), ...(next.exclude || [])])
    ),
  };
  if (next.low_confidence) out.low_confidence = next.low_confidence;
  return out;
}

/** ---------- ③ 웨이크워드(“세이고”) 모드 ---------- **/
function startWakeWordMode(wake = "세이고", onWake: () => void) {
  const SR =
    (window as any).webkitSpeechRecognition ||
    (window as any).SpeechRecognition;
  if (!SR) {
    alert("이 브라우저는 음성 인식을 지원하지 않습니다.");
    return () => {};
  }
  const rec = new SR();
  rec.lang = "ko-KR";
  rec.continuous = true;
  rec.interimResults = true;

  let stoppedByUs = false;
  rec.onresult = (e: any) => {
    const txt = Array.from(e.results)
      .map((r: any) => r[0].transcript)
      .join("");
    if (txt.includes(wake)) {
      stoppedByUs = true;
      rec.stop(); // 호출어 감지 → 잠시 멈추고
      onWake(); // 상세 맥락의 명령 녹음 실행
      setTimeout(() => {
        if (!stoppedByUs) return;
        stoppedByUs = false;
        rec.start();
      }, 800);
    }
  };
  rec.onerror = () => setTimeout(() => rec.start(), 300);
  rec.onend = () => setTimeout(() => rec.start(), 300);
  rec.start();
  return () => {
    stoppedByUs = true;
    rec.abort();
  };
}

/** ==================== 상세 컴포넌트 ==================== **/
export default function Detail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const q = useSearchParams();

  const [item, setItem] = useState<MenuItem | null>(null);
  const [heard, setHeard] = useState("");
  const [slots, setSlots] = useState<Slots | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 웨이크워드 ON/OFF
  const [wakeOn, setWakeOn] = useState(false);
  const stopWakeRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    fetch("/menu_popular.json")
      .then((r) => r.json())
      .then((list: MenuItem[]) => {
        setItem(list.find((x) => x.id === id) || null);
      });
  }, [id]);

  // 자동 테스트(?auto=1 → public/audio/test1.mp3)
  useEffect(() => {
    if (q.get("auto") === "1") autoInferFromPublic("/audio/test1.mp3");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  async function autoInferFromPublic(url: string) {
    const res = await fetch(url);
    const blob = await res.blob();
    const fd = new FormData();
    fd.append(
      "file",
      new File([blob], "test1.mp3", { type: blob.type || "audio/mpeg" })
    );
    const r = await fetch(`${API}/infer`, { method: "POST", body: fd });
    const j = await r.json();
    applyInferResult(j);
  }

  /** /infer 결과를 머지하여 반영 */
  function applyInferResult(j: any) {
    setHeard(j.text || "");
    setSlots((prev) => mergeSlots(prev, j.slots));
    const merged = mergeSlots(slots, j.slots);
    const req = ["main", "size", "bread", "cheese"];
    setMissing(req.filter((k) => !(merged as any)?.[k]));
    setSummary(j.summary);
  }

  /** 무음감지 녹음 → /infer */
  const micOnce = async () => {
    const blob = await recordUntilSilence({
      minMs: 900,
      maxMs: 6000,
      silenceDb: -52,
    });
    const fd = new FormData();
    fd.append("file", new File([blob], "mic.webm", { type: "audio/webm" }));
    const r = await fetch(`${API}/infer`, { method: "POST", body: fd });
    applyInferResult(await r.json());
  };

  /** 파일 업로드 → /infer */
  const uploadFile = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch(`${API}/infer`, { method: "POST", body: fd });
    applyInferResult(await r.json());
  };

  /** 저장 */
  const save = async () => {
    if (!slots) return;
    if (missing.length > 0) return alert("필수 누락: " + missing.join(", "));
    const ok = confirm("이대로 주문하시겠습니까?\n\n" + summary);
    if (!ok) return;
    const r = await fetch(`${API}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slots, summary }),
    });
    const j = await r.json();
    if (j.ok) alert(`장바구니 담김! 주문ID: ${j.order_id}`);
  };

  /** 웨이크워드 토글 */
  const toggleWake = () => {
    if (wakeOn) {
      stopWakeRef.current?.();
      stopWakeRef.current = null;
      setWakeOn(false);
      alert("웨이크워드 OFF");
    } else {
      stopWakeRef.current = startWakeWordMode("세이고", micOnce); // “세이고”라고 부르면 micOnce 실행
      setWakeOn(true);
      alert("웨이크워드 ON: '세이고'");
    }
  };

  if (!item)
    return (
      <main className="container-narrow">
        <p>메뉴를 찾을 수 없습니다.</p>
      </main>
    );

  return (
    <main className="container-narrow space-y-4">
      <div className="flex items-center justify-between">
        <button className="btn" onClick={() => router.push("/kiosk")}>
          ← 뒤로
        </button>
        <div className="flex gap-2">
          <button
            className={`btn ${wakeOn ? "btn-yellow" : ""}`}
            onClick={toggleWake}
          >
            {wakeOn ? "웨이크워드 ON" : "웨이크워드 ON"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={uploadFile}
          />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            파일로 테스트
          </button>
          <button className="btn-sub" onClick={micOnce}>
            🎤 음성 인식
          </button>
        </div>
      </div>

      <section className="card">
        <div className="flex items-center justify-between">
          <h1
            className="text-xl font-bold"
            style={{ color: "var(--sub-green)" }}
          >
            {item.name}
          </h1>
          <button className="btn-yellow" onClick={save}>
            주문하기
          </button>
        </div>
        <div className="mt-3 grid grid-cols-12 gap-4">
          <img
            src={item.image}
            className="col-span-4 w-full h-28 object-contain border rounded-md"
          />
          <p className="col-span-8 text-gray-700">{item.desc}</p>
        </div>
        {heard && (
          <div className="mt-2 text-sm text-gray-600">인식: “{heard}”</div>
        )}
      </section>

      {slots && (
        <section className="card space-y-2">
          <div className="font-semibold">인식 결과</div>
          <div className="flex flex-wrap gap-2">
            <span className={`chip ${missing.includes("main") ? "miss" : ""}`}>
              메인: {slots.main ?? "-"}
            </span>
            <span className={`chip ${missing.includes("size") ? "miss" : ""}`}>
              사이즈: {slots.size ?? "-"}
            </span>
            <span className={`chip ${missing.includes("bread") ? "miss" : ""}`}>
              빵: {slots.bread ?? "-"}
            </span>
            <span
              className={`chip ${missing.includes("cheese") ? "miss" : ""}`}
            >
              치즈: {slots.cheese ?? "-"}
            </span>
          </div>
          <div className="text-sm text-gray-700">
            야채: {slots.veggies?.join(", ") || "-"}
          </div>
          <div className="text-sm text-gray-700">
            소스: {slots.sauces?.join(", ") || "-"}
          </div>
          <div className="text-sm text-gray-700">
            빼기: {slots.exclude?.join(", ") || "없음"}
          </div>

          {summary && (
            <div
              className="mt-2 p-2 rounded text-sm"
              style={{ background: "#FFFCF0", border: "1px solid #FDE68A" }}
            >
              <div className="font-semibold mb-1">요약</div>
              <div className="whitespace-pre-wrap">{summary}</div>
            </div>
          )}

          <div className="flex gap-2">
            <button className="btn" onClick={micOnce}>
              🎤 다시 말하기
            </button>
            <button className="btn-yellow" onClick={save}>
              주문하기
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
