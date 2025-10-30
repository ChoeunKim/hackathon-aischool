"use client";
import { useEffect, useRef, useState } from "react";

type MenuItem = { id:number; name:string; desc:string; image:string };
type Slots = {
  main?:string; size?:string; bread?:string; cheese?:string;
  veggies:string[]; sauces:string[]; exclude:string[];
  low_confidence?:Record<string,any>;
};

const API = "http://127.0.0.1:8000";

export default function Kiosk(){
  // 데이터/상태
  const [popular,setPopular]=useState<MenuItem[]>([]);
  const [picked,setPicked]=useState<MenuItem|null>(null);

  const [heard,setHeard]=useState("");     // STT 결과
  const [slots,setSlots]=useState<Slots|null>(null);
  const [missing,setMissing]=useState<string[]>([]);
  const [summary,setSummary]=useState("");

  const fileRef = useRef<HTMLInputElement|null>(null);

  useEffect(()=>{ fetch("/menu_popular.json").then(r=>r.json()).then(setPopular); },[]);

  // ── 음성 2초 녹음 → /infer
  const micOnce = async ()=>{
    const s = await navigator.mediaDevices.getUserMedia({audio:true});
    const rec = new MediaRecorder(s);
    const chunks:BlobPart[]=[];
    rec.ondataavailable=e=>{ if(e.data.size>0) chunks.push(e.data); };
    rec.onstop = async ()=>{
      const blob=new Blob(chunks,{type:"audio/webm"});
      const fd=new FormData(); fd.append("file", new File([blob],"mic.webm",{type:"audio/webm"}));
      const r=await fetch(`${API}/infer`,{method:"POST",body:fd});
      const j=await r.json();
      setHeard(j.text||""); setSlots(j.slots); setMissing(j.missing); setSummary(j.summary);
      s.getTracks().forEach(t=>t.stop());

      // 홈에서 번호를 말한 경우 자동 선택
      const map:Record<string,number>={"하나":1,"둘":2,"셋":3};
      const k=Object.keys(map).find(k=>j.text?.includes(k));
      const n = k ? map[k] : parseInt(j.text?.match(/\d+/)?.[0]||"0",10);
      const found = popular.find(m=>m.id===n);
      if(found) setPicked(found);
    };
    rec.start(); setTimeout(()=>rec.stop(), 1800);
  };

  // 파일 업로드로도 테스트 가능
  const uploadFile = async ()=>{
    const f=fileRef.current?.files?.[0]; if(!f) return alert("파일 선택");
    const fd=new FormData(); fd.append("file",f);
    const r=await fetch(`${API}/infer`,{method:"POST",body:fd});
    const j=await r.json();
    setHeard(j.text||""); setSlots(j.slots); setMissing(j.missing); setSummary(j.summary);
  };

  const speak = (t:string)=>{ const u=new SpeechSynthesisUtterance(t); u.lang="ko-KR"; speechSynthesis.cancel(); speechSynthesis.speak(u); };

  const save = async ()=>{
    if(!slots) return;
    if(missing.length>0) return alert("필수 누락: "+missing.join(", "));
    const ok=confirm("이대로 주문하시겠습니까?\n\n"+summary);
    if(!ok) return;
    const r=await fetch(`${API}/save`,{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({slots,summary})});
    const j=await r.json();
    if(j.ok) alert(`장바구니 담김! 주문ID: ${j.order_id}`);
  };

  // ── UI
  return (
    <main className="container-narrow space-y-6">
      {/* 상단 바 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/img/ui/saygo-logo.svg" alt="say&go" className="h-8"/>
          <span className="badge">음성 주문 데모</span>
        </div>
        <div className="flex items-center gap-2">
          <input type="file" ref={fileRef} accept="audio/*" className="hidden" onChange={uploadFile}/>
          <button className="btn" onClick={()=>fileRef.current?.click()}>파일로 테스트</button>
          <button className="btn-sub" onClick={micOnce}>🎤 말하기</button>
        </div>
      </div>

      {/* 3-컬럼 레이아웃 */}
      <div className="grid grid-cols-12 gap-6">
        {/* 좌: 브랜드 패널 */}
        <section className="col-span-3 card flex items-center justify-center" style={{background:"#EEF7F1", borderColor:"var(--sub-green)"}}>
          <img src="/img/ui/saygo-logo.svg" className="h-16 opacity-90" alt="say&go"/>
        </section>

        {/* 중앙: 인기메뉴 + 번호버튼 컨셉 */}
        <section className="col-span-6">
          <div className="card" style={{position:"relative"}}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-semibold">원하는 샌드위치 번호를 말해주세요.</div>
                <div className="text-sm text-gray-500">예) “1번 / 2번 / 3번”</div>
              </div>
              <button className="btn-ghost" onClick={micOnce}>🎤</button>
            </div>

            <div className="grid grid-cols-5 gap-3">
              {/* 메뉴 카드들(3) */}
              <div className="col-span-4 grid gap-3">
                {popular.map(m=>(
                  <button key={m.id} onClick={()=>setPicked(m)} className="card hover:shadow flex items-center gap-3">
                    <img src={m.image} className="w-20 h-14 object-contain rounded-md border" />
                    <div className="text-left">
                      <div className="font-semibold">{m.name}</div>
                      <div className="text-xs text-gray-500 line-clamp-2">{m.desc}</div>
                    </div>
                  </button>
                ))}
              </div>

              {/* 우측 노랑 번호바 */}
              <div className="col-span-1 flex flex-col gap-3">
                {[1,2,3].map(n=>(
                  <button key={n} onClick={()=>setPicked(popular.find(m=>m.id===n) || null)}
                    className="btn-yellow text-2xl font-black py-6 rounded-xl">{n}</button>
                ))}
              </div>
            </div>

            {/* 인식 텍스트 노출 */}
            {heard && <div className="mt-3 text-sm text-gray-600">인식: “{heard}”</div>}
          </div>
        </section>

        {/* 우: 힌트/디스플레이 패널(큰 숫자 느낌) */}
        <section className="col-span-3 card flex items-center justify-center">
          <div className="text-5xl font-black tracking-widest" style={{color:"var(--sub-green)"}}>1 2 3</div>
        </section>
      </div>

      {/* 선택 후: 상세 카드 + “설명/주문” */}
      {picked && (
        <section className="grid grid-cols-12 gap-6">
          <div className="col-span-6 card">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold" style={{color:"var(--sub-green)"}}>{picked.name}</h2>
              <div className="flex gap-2">
                <button className="btn" onClick={()=>speak(`${picked.name}. ${picked.desc}`)}>메뉴 설명해줘</button>
                <button className="btn-sub" onClick={save}>주문하기</button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-12 gap-4">
              <img src={picked.image} className="col-span-4 w-full h-28 object-contain border rounded-md" />
              <p className="col-span-8 text-gray-700">{picked.desc}</p>
            </div>
            <p className="mt-2 text-xs text-gray-500">음성 명령 예: “할라피뇨 빼고 전부”, “렌치만”, “주문하기”</p>
          </div>

          {/* 우측: 파싱 결과/요약(실시간) */}
          {slots && (
            <div className="col-span-6 card space-y-2">
              <div className="font-semibold">인식 결과</div>
              <div className="flex flex-wrap gap-2">
                <span className={`chip ${missing.includes("main")?"miss":""}`}>메인: {slots.main ?? "-"}</span>
                <span className={`chip ${missing.includes("size")?"miss":""}`}>사이즈: {slots.size ?? "-"}</span>
                <span className={`chip ${missing.includes("bread")?"miss":""}`}>빵: {slots.bread ?? "-"}</span>
                <span className={`chip ${missing.includes("cheese")?"miss":""}`}>치즈: {slots.cheese ?? "-"}</span>
              </div>
              <div className="text-sm text-gray-700">야채: {slots.veggies?.join(", ") || "-"}</div>
              <div className="text-sm text-gray-700">소스: {slots.sauces?.join(", ") || "-"}</div>
              <div className="text-sm text-gray-700">빼기: {slots.exclude?.join(", ") || "없음"}</div>

              {summary && (
                <div className="mt-2 p-2 rounded text-sm" style={{background:"#FFFCF0", border:"1px solid #FDE68A"}}>
                  <div className="font-semibold mb-1">요약</div>
                  <div className="whitespace-pre-wrap">{summary}</div>
                </div>
              )}

              <div className="flex gap-2">
                <button className="btn" onClick={micOnce}>🎤 다시 말하기</button>
                <button className="btn-yellow" onClick={save}>주문하기</button>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
