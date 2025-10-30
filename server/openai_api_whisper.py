# openai_api_whisper.py
from openai import OpenAI
from dotenv import load_dotenv
import os

# 루트 경로 계산 (.../sub)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 오디오 파일 경로 지정 (절대경로로 안전하게)
audio_file_path = os.path.join(BASE_DIR, 'app', 'audio', 'test2.mp3')

# .env 불러오기
load_dotenv(os.path.join(BASE_DIR, '.env'))

# API 키 가져오기
api_key = os.getenv('OPENAI_API_KEY')
client = OpenAI(api_key=api_key)

# 음성 파일 열기
with open(audio_file_path, 'rb') as audio_file:
    transcription = client.audio.transcriptions.create(
        model="whisper-1",
        file=audio_file
    )

print("🎧 인식된 텍스트:")
print(transcription.text)
