# server/app.py
from fastapi import FastAPI, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI
from dotenv import load_dotenv
from pathlib import Path
import os, io, json, sqlite3, re
from rapidfuzz import process, fuzz

BASE = Path(__file__).resolve().parents[1]
load_dotenv(BASE / ".env")

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MENU = json.load(open(BASE/"public"/"subway_menu_ko_v3.json", encoding="utf-8"))
DB = BASE/"orders.db"

def init_db():
    with sqlite3.connect(DB) as c:
        c.execute("""CREATE TABLE IF NOT EXISTS orders(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payload TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""")
init_db()

@app.get("/health")
def health(): return {"ok": True}

# ========= 미니 파서(서버내장) =========
def _fz(one, pool, ok=80, maybe=60):
    m = process.extractOne(one, pool, scorer=fuzz.WRatio)
    if not m: return None, None
    cand, score = m[0], m[1]
    return (cand, "ok") if score>=ok else ((cand,"maybe") if score>=maybe else (None,"no"))

def parse_text(text:str):
    t = text.lower()

    # --- 교정맵: 오타/띄어쓰기 보정 ---
    repl = {
        "슈렘프": "슈림프", "쉬림프": "슈림프",  "시림프": "슈림프",
        "허니 옷": "허니오트", "허니옷": "허니오트",
        "허니오토": "허니오트", "허니오토로": "허니오트",
        "스위트 칠리": "스위트칠리"
    }
    for a,b in repl.items():
        t = t.replace(a,b)

    # --- 조사/불용어 제거 ---
    t = re.sub(r"(은|는|이|가|을|를|으로|로|에|에서|와|과|의)\b", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()

    slots = {"main":None,"size":None,"bread":None,"cheese":None,
             "veggies":[], "sauces":[], "exclude":[], "notes":""}
    low = {}

    # 사이즈
    if re.search(r"\b(30|30cm|라지)\b", t): slots["size"]="30"
    elif re.search(r"\b(15|15cm|레귤러)\b", t): slots["size"]="15"

    # 키워드 우선 매칭 함수
    def pick_after_keyword(t, keywords, candidates):
        m = re.search(r"(" + "|".join(map(re.escape, keywords)) + r")\s*(?:[^\S\r\n]+)?([^\s,\.]+)", t)
        if not m: return None, None
        word = m.group(2)
        return _fz(word, candidates)

    # 먼저 키워드 기반으로 bread/cheese 시도
    b_cand, b_conf = pick_after_keyword(t, ["빵","브레드"], MENU["breads"])
    if b_cand: slots["bread"] = b_cand
    c_cand, c_conf = pick_after_keyword(t, ["치즈"], MENU["cheeses"])
    if c_cand: slots["cheese"] = c_cand

    # 전역 퍼지(보완)
    for k,pool in [("main",MENU["mains"]),
                   ("bread",MENU["breads"]),
                   ("cheese",MENU["cheeses"])]:
        if not slots[k]:
            v,c = _fz(t,pool)
            if v and c=="ok": slots[k]=v
            elif v and c=="maybe": low[k]=v

    ALL_V, ALL_S = MENU["veggies"], MENU["sauces"]

    # 'X 빼고 다/전부'
    for x,_ in re.findall(r"(\S+)\s*빼고\s*(다|전부)", t):
        v,_=_fz(x,ALL_V+ALL_S); slots["exclude"].append(v or x)

    # 'X만'
    for x in re.findall(r"(\S+)\s*만", t):
        v,_=_fz(x,ALL_V+ALL_S); x=v or x
        if x in ALL_V: slots["veggies"]=[x]
        if x in ALL_S: slots["sauces"]=[x]

    for v in ALL_V:
        if v in t: slots["veggies"].append(v)
    for s in ALL_S:
        if s in t: slots["sauces"].append(s)

    if re.search(r"야채.*(다|전부)", t) and not slots["veggies"]:
        slots["veggies"]=ALL_V[:]
    if re.search(r"(소스|소스는?).*(다|전부)", t) and not slots["sauces"]:
        slots["sauces"]=ALL_S[:]

    veg=set(slots["veggies"] or ALL_V)
    slots["veggies"]=[v for v in veg if v not in slots["exclude"]]
    slots["sauces"]=[s for s in set(slots["sauces"]) if s not in slots["exclude"]]

    # 필수 누락
    req=["main","size","bread","cheese"]
    missing=[k for k in req if not slots[k]]

    # main 강제 + 키워드 있으면 cheese/bread도 승격
    if "main" in missing and "main" in low:
        slots["main"]=low["main"]; missing.remove("main"); low["forced_main"]=True
    if not slots["bread"] and "bread" in low and "빵" in text:
        slots["bread"]=low["bread"]
    if not slots["cheese"] and "cheese" in low and "치즈" in text:
        slots["cheese"]=low["cheese"]

    if low: slots["low_confidence"]=low
    return slots, missing


def build_summary(s):
    veg = ", ".join(s.get("veggies") or []) or "기본"
    sau = ", ".join(s.get("sauces") or []) or "선택 안 함"
    ex  = ", ".join(s.get("exclude") or []) or "없음"
    return f"메인:{s.get('main') or '-'} / 사이즈:{s.get('size') or '-'} / 빵:{s.get('bread') or '-'} / 치즈:{s.get('cheese') or '-'} / 야채:{veg} / 소스:{sau} / 빼기:{ex}"

# ========= 단일 파이프: 업로드 음성 → 변환 → 파싱/요약 =========
@app.post("/infer")  # UploadFile: file
async def infer(file: UploadFile):
    audio_bytes = await file.read()
    with io.BytesIO(audio_bytes) as f:
        f.name = file.filename
        tr = client.audio.transcriptions.create(model="whisper-1", file=f)
    slots, missing = parse_text(tr.text)
    return {"text": tr.text, "slots": slots, "missing": missing, "summary": build_summary(slots)}

# ========= 저장 =========
class Order(BaseModel):
    slots: dict
    summary: str

@app.post("/save")
async def save(o: Order):
    req=["main","size","bread","cheese"]
    miss=[k for k in req if not o.slots.get(k)]
    if miss: raise HTTPException(400, f"Missing required fields: {', '.join(miss)}")
    with sqlite3.connect(DB) as c:
        cur=c.cursor()
        cur.execute("INSERT INTO orders(payload) VALUES (?)",[json.dumps({"slots":o.slots,"summary":o.summary}, ensure_ascii=False)])
        c.commit(); oid=cur.lastrowid
    return {"ok": True, "order_id": oid}

# --- 주문 조회용 (추가) ---
import sqlite3, json
from fastapi.responses import JSONResponse

@app.get("/orders")
def orders(limit: int = 20):
    with sqlite3.connect(DB) as c:
        cur = c.cursor()
        cur.execute("SELECT id, payload, created_at FROM orders ORDER BY id DESC LIMIT ?", (limit,))
        rows = cur.fetchall()
    items = []
    for oid, payload, ts in rows:
        data = json.loads(payload)
        items.append({"id": oid, "summary": data.get("summary"), "slots": data.get("slots"), "created_at": ts})
    return {"ok": True, "items": items}

@app.get("/orders/{order_id}")
def order_detail(order_id: int):
    with sqlite3.connect(DB) as c:
        cur = c.cursor()
        cur.execute("SELECT id, payload, created_at FROM orders WHERE id=?", (order_id,))
        row = cur.fetchone()
    if not row:
        return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
    return {"ok": True, "id": row[0], "created_at": row[2], **json.loads(row[1])}

