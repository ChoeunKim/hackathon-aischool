"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

type MenuItem = { id:number; name:string; desc:string; image:string };
type Slots = { main?:string; size?:string; bread?:string; cheese?:string; veggies:string[]; sauces:string[]; exclude:string[]; low_confidence?:Record<string,any> };

const API = "http://127.0.0.1:8000";

export default function Detail(){
  const params = useParams<{id:string}>(); const id = Number(params.id);
  const router = useRouter(); const q = useSearchParams();
  const [item,setItem]=useState<MenuItem|null>(null);
  const [heard,setHeard]=useState(""); const [slots,setSlots]=useState<Slots|null>(null);
  const [missing,setMissing]=useState<string[]>([]); const [summary,setSummary]=useState("");
  const fileRef = useRef<HTMLInputElement|null>(null);

  useEffect(()=>{
    fetch("/menu_popular.json").then(r=>r.json()).then((list:MenuItem[])=>{
      setItem(list.find(x=>x.id===id) || null);
    });
  },[id]);

  // 자동 테스트 (?auto=1 → public/audio/test1.mp3 사용)
  useEffect(()=>{
    if(q.get("auto")==="1") autoInferFromPublic("/audio/test1.mp3");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[item]);

  const autoInferFromPublic = async (url:string)=>{
    const res = await fetch(url); const blob = await res.blob();
    const fd = new FormData();
    fd.append("file", new File([blob], "test1.mp3", {type: blob.type || "audio/mpeg"}));
    const r = await fetch(`${API}/infer`, {method:"POST", body:fd});
    const j = await r.json();
    setHeard(j.text||""); setSlots(j.slots); setMissing(j.missing); setSummary(j.summary);
  };

  const micOnce = async ()=>{
    const s = await navigator.mediaDevices.getUserMedia({audio:true});
    const rec = new MediaRecorder(s); const chunks:BlobPart[]=[];
    rec.ondataavailable=e=>{ if(e.data.size>0) chunks.push(e.data); };
    rec.onstop = async ()=>{
      const blob=new Blob(chunks,{type:"audio/webm"});
      const fd=new FormData(); fd.append("file", new File([blob],"mic.webm",{type:"audio/webm"}));
      const r=await fetch(`${API}/infer`,{method:"POST",body:fd});
      const j=await r.json();
      setHeard(j.text||""); setSlots(j.slots); setMissing(j.missing); setSummary(j.summary);
      s.getTracks().forEach(t=>t.stop());
    };
    rec.start(); setTimeout(()=>rec.stop(),1800);
  };

  const uploadFile = async ()=>{
    const f=fileRef.current?.files?.[0]; if(!f) return;
    const fd=new FormData(); fd.append("file", f);
    const r=await fetch(`${API}/infer`,{method:"POST",body:fd});
    const j=await r.json();
    setHeard(j.text||""); setSlots(j.slots); setMissing(j.missing); setSummary(j.summary);
  };

  const save = async ()=>{
    if(!slots) return;
    if(missing.length>0) return alert("필수 누락: "+missing.join(", "));
    const ok=confirm("이대로 주문하시겠습니까?\n\n"+summary);
    if(!ok) return;
    const r=await fetch(`${API}/save`,{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({slots, summary})});
    const j=await r.json(); if(j.ok) alert(`장바구니 담김! 주문ID: ${j.order_id}`);
  };

  if(!item) return <main className="container-narrow"><p>메뉴를 찾을 수 없습니다.</p></main>;

  return (
    <main className="container-narrow space-y-4">
      <div className="flex items-center justify-between">
        <button className="btn" onClick={()=>router.push("/kiosk")}>← 뒤로</button>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={uploadFile}/>
          <button className="btn" onClick={()=>fileRef.current?.click()}>파일로 테스트</button>
          <button className="btn-sub" onClick={micOnce}>🎤 음성 인식</button>
        </div>
      </div>

      <section className="card">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold" style={{color:"var(--sub-green)"}}>{item.name}</h1>
          <button className="btn-yellow" onClick={save}>주문하기</button>
        </div>
        <div className="mt-3 grid grid-cols-12 gap-4">
          <img src={item.image} className="col-span-4 w-full h-28 object-contain border rounded-md"/>
          <p className="col-span-8 text-gray-700">{item.desc}</p>
        </div>
        {heard && <div className="mt-2 text-sm text-gray-600">인식: “{heard}”</div>}
      </section>

      {slots && (
        <section className="card space-y-2">
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
        </section>
      )}
    </main>
  );
}
