"use client";
import { useState } from "react";

export default function MicButton({ onText }:{ onText:(t:string)=>void }){
  const [busy, setBusy] = useState(false);

  const recordOnce = async () => {
    if (busy) return;
    setBusy(true);
    try{
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      const media = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      media.ondataavailable = e => { if(e.data.size>0) chunks.push(e.data); };
      media.onstop = async () => {
        const blob = new Blob(chunks, {type:"audio/webm"});
        const fd = new FormData();
        fd.append("file", new File([blob], "mic.webm", {type:"audio/webm"}));
        const r = await fetch("http://127.0.0.1:8000/transcribe", {method:"POST", body:fd});
        const j = await r.json();
        onText(j.text || "");
        stream.getTracks().forEach(t=>t.stop());
        setBusy(false);
      };
      media.start();
      setTimeout(()=>media.stop(), 2000); // 2초 녹음
    }catch(e){ console.error(e); setBusy(false); }
  };

  return (
    <button onClick={recordOnce} className="btn-sub">{busy? "인식중..." : "🎤 말하기"}</button>
  );
}
