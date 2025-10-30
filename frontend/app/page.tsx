"use client";

import { useEffect, useRef, useState } from "react";

export default function Page() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioURL, setAudioURL] = useState<string>("");
  const [result, setResult] = useState<string>("");
  const [status, setStatus] = useState<string>("idle");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // 권한 요청은 버튼 클릭 시 getUserMedia를 호출해도 됩니다.
  const startRecording = async () => {
    try {
      setResult("");
      setStatus("requesting mic...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // 브라우저별 지원 mimeType 탐색
      const preferredTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4", // Safari
      ];
      let mimeType = "";
      for (const t of preferredTypes) {
        if (MediaRecorder.isTypeSupported(t)) {
          mimeType = t;
          break;
        }
      }

      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioURL(url);
        setStatus(`recorded ${Math.round(blob.size / 1024)} KB`);
      };

      mr.start();
      setIsRecording(true);
      setStatus("recording...");
      console.log("[Recorder] started with mimeType =", mr.mimeType);
    } catch (err) {
      console.error(err);
      setStatus("mic permission or recorder error");
      alert("마이크 권한 또는 녹음 시작 중 오류가 발생했습니다.");
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.stop();
      mr.stream.getTracks().forEach((t) => t.stop());
      setIsRecording(false);
      setStatus("stopped");
      console.log("[Recorder] stopped");
    }
  };

  const uploadAndTranscribe = async () => {
    if (!audioURL) {
      alert("먼저 녹음하세요.");
      return;
    }
    setStatus("uploading...");
    setResult("");

    // Blob을 다시 가져와 FormData로 업로드
    const resBlob = await fetch(audioURL).then((r) => r.blob());

    // 파일명/확장자는 백엔드 포맷 판별에 도움됨 (webm 또는 m4a/mp4 등)
    // 브라우저가 webm을 주는 경우가 많습니다.
    const ext =
      resBlob.type.includes("webm") ? "webm" :
      resBlob.type.includes("mp4")  ? "mp4"  :
      resBlob.type.includes("m4a")  ? "m4a"  :
      "webm";
    const filename = `record.${ext}`;

    const fd = new FormData();
    fd.append("file", resBlob, filename);

    try {
      const resp = await fetch("http://localhost:8000/transcribe", {
        method: "POST",
        body: fd,
      });
      if (!resp.ok) {
        const t = await resp.text();
        console.error("[Transcribe] HTTP", resp.status, t);
        setStatus(`transcribe failed: ${resp.status}`);
        alert("서버 변환 오류가 발생했습니다. 콘솔 로그를 확인하세요.");
        return;
      }
      const data = await resp.json();
      console.log("[Transcribe] result =", data);
      setResult(data.text || "");
      setStatus("done");
    } catch (e) {
      console.error(e);
      setStatus("network or server error");
      alert("네트워크/서버 오류가 발생했습니다.");
    }
  };

  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      <h1>🎙️ 브라우저 녹음 → FastAPI 전송 → 텍스트 변환</h1>

      <div style={{ display: "flex", gap: 8 }}>
        {!isRecording ? (
          <button onClick={startRecording}>녹음 시작</button>
        ) : (
          <button onClick={stopRecording}>녹음 정지</button>
        )}
        <button onClick={uploadAndTranscribe} disabled={!audioURL}>
          업로드 & 변환
        </button>
        <span style={{ opacity: 0.7 }}>status: {status}</span>
      </div>

      {/* 녹음 확인용 오디오 플레이어 */}
      {audioURL && (
        <audio src={audioURL} controls style={{ width: 400 }} />
      )}

      {/* 변환 결과 */}
      {result && (
        <div style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>
          <h3>📝 변환된 텍스트</h3>
          <p>{result}</p>
        </div>
      )}
    </main>
  );
}
