"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

type MenuItem = { id:number; name:string; desc:string; image:string };

const API = "http://127.0.0.1:8000";

// 웨이크워드(“세이고”) → 번호 듣기 실행
function startWakeWordMode(wake="세이고", onWake:()=>void){
  const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
  if (!SR) { alert("이 브라우저는 음성 인식을 지원하지 않습니다."); return ()=>{}; }
  const rec = new SR();
  rec.lang = "ko-KR"; rec.continuous = true; rec.interimResults = true;

  let stoppedByUs = false;
  rec.onresult = (e:any)=>{
    const txt = Array.from(e.results).map((r:any)=>r[0].transcript).join("");
    if (txt.includes(wake)) {
      stoppedByUs = true; rec.stop(); onWake();
      setTimeout(()=>{ if(!stoppedByUs) return; stoppedByUs=false; rec.start(); }, 800);
    }
  };
  rec.onerror = ()=> setTimeout(()=>rec.start(), 300);
  rec.onend   = ()=> setTimeout(()=>rec.start(), 300);
  rec.start();
  return ()=>{ stoppedByUs = true; rec.abort(); };
}

export default function KioskHome(){
  const [popular,setPopular]=useState<MenuItem[]>([]);
  const [heard,setHeard]=useState("");
  const [wakeOn,setWakeOn]=useState(false);
  const stopWakeRef = useRef<null | (()=>void)>(null);
  const router = useRouter();

  useEffect(()=>{ fetch("/menu_popular.json").then(r=>r.json()).then(setPopular); },[]);

  const go = (id:number)=> router.push(`/kiosk/${id}`);

  // 간단 고정 2초 녹음 → /infer로 숫자 판단 (목록은 간단 고정시간으로도 충분)
  const micNumber = async ()=>{
    const s = await navigator.mediaDevices.getUserMedia({audio:true});
    const rec = new MediaRecorder(s);
    const chunks:BlobPart[]=[];
    rec.ondataavailable=e=>{ if(e.data.size>0) chunks.push(e.data); };
    rec.onstop = async ()=>{
      const blob=new Blob(chunks,{type:"audio/webm"});
      const fd=new FormData(); fd.append("file", new File([blob],"mic.webm",{type:"audio/webm"}));
      const r=await fetch(`${API}/infer`,{method:"POST",body:fd});
      const j=await r.json(); setHeard(j.text||"");
      s.getTracks().forEach(t=>t.stop());

      const map:Record<string,number>={"하나":1,"둘":2,"셋":3};
      const k=Object.keys(map).find(k=>j.text?.includes(k));
      const n = k ? map[k] : parseInt(j.text?.match(/\d+/)?.[0]||"0",10);
      if ([1,2,3].includes(n)) go(n);
    };
    rec.start(); setTimeout(()=>rec.stop(), 1800);
  };

  const toggleWake = ()=>{
    if (wakeOn) { stopWakeRef.current?.(); stopWakeRef.current=null; setWakeOn(false); alert("웨이크워드 OFF"); }
    else { stopWakeRef.current = startWakeWordMode("세이고", micNumber); setWakeOn(true); alert("웨이크워드 ON: '세이고'"); }
  };

  return (
    <main className="container-narrow space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{color:"var(--sub-green)"}}>SAY&GO 인기 메뉴</h1>
        <div className="flex gap-2">
          <button className={`btn ${wakeOn?"btn-yellow":""}`} onClick={toggleWake}>
            {wakeOn ? "웨이크워드 ON" : "웨이크워드 ON"}
          </button>
          <button className="btn-sub" onClick={micNumber}>🎤 번호 말하기</button>
        </div>
      </div>

      <div className="kiosk-grid">
        {popular.map(m=>(
          <button key={m.id} className="card text-left" onClick={()=>go(m.id)}>
            <img className="thumb" src={m.image} alt={m.name}/>
            <div className="mt-2 font-semibold">{m.id}. {m.name}</div>
            <div className="text-sm text-gray-500">{m.desc}</div>
          </button>
        ))}
      </div>

      {heard && <div className="text-sm text-gray-600">인식: “{heard}”</div>}
      <p className="text-xs text-gray-500">음성: “1번/2번/3번” 또는 각 카드를 터치하세요.</p>
    </main>
  );
}
