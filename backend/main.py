from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from dotenv import load_dotenv
import tempfile, os, shutil, logging

# ✅ .env 로드
load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # 개발 프론트 오리진
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger(__name__)

# OpenAI 클라이언트 (환경변수 OPENAI_API_KEY 사용 권장)
api_key = os.getenv("OPENAI_API_KEY")

if not api_key:
    raise RuntimeError("❌ OPENAI_API_KEY not found in environment or .env file")

client = OpenAI(api_key=api_key)


# content-type → 확장자 매핑 (필요시 추가)
CT2EXT = {
    "audio/webm": ".webm",
    "audio/webm;codecs=opus": ".webm",
    "audio/mp4": ".mp4",
    "audio/m4a": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/oga": ".oga",
    "video/mp4": ".mp4",   # 일부 브라우저가 이걸로 줄 수 있음
}

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "파일명이 없습니다.")
    if not (file.content_type or "").startswith(("audio/", "video/")):
        raise HTTPException(400, f"오디오/비디오가 아닙니다. content_type={file.content_type}")

    # 확장자 보정
    _, ext0 = os.path.splitext(file.filename)
    ext = ext0 if ext0 else CT2EXT.get(file.content_type, ".webm")

    # 임시 파일 경로 생성 (확장자 유지)
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    # 파일 사이즈/메타 로그
    try:
        size = os.path.getsize(tmp_path)
        logger.info(f"[UPLOAD] name={file.filename} ct={file.content_type} -> saved={tmp_path} size={size}B")
    except Exception:
        pass

    try:
        # OpenAI Whisper 호출
        with open(tmp_path, "rb") as f:
            transcription = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
            )
        text = transcription.text or ""
        logger.info(f"[TRANSCRIBE] result: {text[:200]}{'...' if len(text) > 200 else ''}")
        return {"text": text}
    except Exception as e:
        logger.exception("[TRANSCRIBE] error")
        raise HTTPException(500, f"Transcribe error: {e}")
    finally:
        # 임시 파일 정리
        try:
            os.remove(tmp_path)
            logger.info(f"[CLEANUP] removed {tmp_path}")
        except Exception:
            pass
