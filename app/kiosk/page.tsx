"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type MenuItem = { id:number; name:string; desc:string; image:string };

export default function KioskHome(){
  const [popular,setPopular]=useState<MenuItem[]>([]);
  const [heard,setHeard]=useState("");
  const router = useRouter();

  useEffect(()=>{ fetch("/menu_popular.json").then(r=>r.json()).then(setPopular); },[]);

  const go = (id:number)=> router.push(`/kiosk/${id}`);

  // 2초 녹음 후 숫자 파싱해 이동
  const micNumber = async ()=>{
    const s = await navigator.mediaDevices.getUserMedia({audio:true});
    const rec = new MediaRecorder(s); const chunks:BlobPart[]=[];
    rec.ondataavailable = e=>{ if(e.data.size>0) chunks.push(e.data); };
    rec.onstop = async ()=>{
      const blob = new Blob(chunks,{type:"audio/webm"});
      const fd = new FormData();
      fd.append("file", new File([blob],"mic.webm",{type:"audio/webm"}));
      const r = await fetch("http://127.0.0.1:8000/infer",{method:"POST",body:fd});
      const j = await r.json(); setHeard(j.text||"");
      s.getTracks().forEach(t=>t.stop());

      const map:Record<string,number>={"하나":1,"둘":2,"셋":3};
      const k = Object.keys(map).find(k=>j.text?.includes(k));
      const n = k ? map[k] : parseInt(j.text?.match(/\d+/)?.[0]||"0",10);
      if ([1,2,3].includes(n)) go(n);
    };
    rec.start(); setTimeout(()=>rec.stop(),1800);
  };

  return (
    <main className="container-narrow space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{color:"var(--sub-green)"}}>SAY&GO 인기 메뉴</h1>
        <button className="btn-sub" onClick={micNumber}>🎤 번호 말하기</button>
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
