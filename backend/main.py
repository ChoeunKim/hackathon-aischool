from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, Body
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from dotenv import load_dotenv


from sqlalchemy.orm import Session
from db import SessionLocal
from models import Menu, Order, OrderItem, OrderItemIngredient, Ingredient

import os, tempfile, shutil, logging, re, json

load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise RuntimeError("❌ OPENAI_API_KEY not found in .env/environment")
client = OpenAI(api_key=api_key)

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
    "video/mp4": ".mp4",
}

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- LLM NLU: JSON Schema 강제 ---
KIOSK_NLU_SCHEMA = {
    "name": "KioskNLU",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "intent": {
                "type": "string",
                "enum": [
                    "SELECT_MENU",
                    "READ_MENU_DESC",
                    "ORDER_CONFIRM",
                    "GO_BACK",
                    "SET_INGREDIENTS",
                    "CANCEL_ORDER",     # NEW
                    "CONFIRM_YES",      # NEW
                    "CONFIRM_NO",       # NEW
                    "NONE"
                ]
            },
            "slots": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "menu_number": {"type": "integer", "minimum": 1},
                    "items": {
                        "type": "array",
                        "items": {"type": "string"},
                        "default": []
                    },
                    "ops": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["ADD","EXCLUDE","ALL","ONLY"]},
                        "default": []
                    }
                }
            },
            "confidence": {"type": "number", "minimum": 0, "maximum": 1}
        },
        "required": ["intent", "slots", "confidence"]
    }
}


def _recalc_total(order: Order) -> int:
    return sum((it.unit_price_cents or 0) * (it.quantity or 1) for it in order.items)


@app.get("/health")
def health():
    return {"ok": True}

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "파일명이 없습니다.")
    if not (file.content_type or "").startswith(("audio/", "video/")):
        raise HTTPException(400, f"오디오/비디오가 아닙니다. content_type={file.content_type}")

    # 확장자 결정
    _, ext0 = os.path.splitext(file.filename)
    ext = ext0 if ext0 else CT2EXT.get(file.content_type, ".webm")

    # 임시 저장
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        size = os.path.getsize(tmp_path)
        logger.info(f"[UPLOAD] name={file.filename} ct={file.content_type} saved={tmp_path} size={size}B")
    except Exception:
        pass

    try:
        with open(tmp_path, "rb") as f:
            transcription = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
            )
        text = transcription.text or ""
        logger.info(f"[TRANSCRIBE] {text[:200]}{'...' if len(text)>200 else ''}")
        return {"text": text}
    except Exception as e:
        logger.exception("[TRANSCRIBE] error")
        raise HTTPException(500, f"Transcribe error: {e}")
    finally:
        try:
            os.remove(tmp_path)
            logger.info(f"[CLEANUP] removed {tmp_path}")
        except Exception:
            pass

# ---- [간단 NLU: 숫자/의도 파싱 1차] ------------------------------------------
# 입력: "3번", "메뉴 설명해줘", "주문하기", "이전으로 돌아가", "양파 빼고 전부 추가해줘", "렌치 소스만 넣어줘"
# 출력: { intent: "...", slots: {...} }
num_map_kr = {
    "하나":1,"둘":2,"셋":3,"넷":4,"다섯":5,"여섯":6,"일곱":7,"여덟":8,"아홉":9,"열":10
}

def extract_number(text: str) -> int | None:
    # 숫자 or '3번' or 한국어 수사
    m = re.search(r"(\d+)\s*번?", text)
    if m: return int(m.group(1))
    for k,v in num_map_kr.items():
        if k in text: return v
    return None

@app.post("/nlu")
async def nlu(payload: dict):
    """
    payload = { "text": "3번", "context": "MAIN_MENU" }
    """
    text = (payload.get("text") or "").strip()
    context = payload.get("context") or ""

    # 기본 의도
    if not text:
        return {"intent":"NONE","slots":{}}

    t = text.replace(" ", "")

    # 전역 취소/확인
    if any(kw in t for kw in ["취소","그만","홈으로","주문취소","처음으로가"]):
        return {"intent":"CANCEL_ORDER","slots":{}}
    if any(kw in t for kw in ["예","네","응","맞아","맞습니다","그래"]):
        return {"intent":"CONFIRM_YES","slots":{}}
    if any(kw in t for kw in ["아니오","아니","아냐","취소하지마","계속"]):
        return {"intent":"CONFIRM_NO","slots":{}}   

    # 공통 의도
    if any(kw in t for kw in ["주문하기","주문해줘","결제"]):
        return {"intent":"ORDER_CONFIRM","slots":{}}
    if any(kw in t for kw in ["이전으로","뒤로","처음으로"]):
        return {"intent":"GO_BACK","slots":{}}
    if any(kw in t for kw in ["메뉴설명","설명해줘","설명듣기"]):
        return {"intent":"READ_MENU_DESC","slots":{}}

    # 컨텍스트별
    if context == "MAIN_MENU":
        n = extract_number(text)
        if n:
            return {"intent":"SELECT_MENU","slots":{"menu_number": n}}
        return {"intent":"NONE","slots":{}}

    if context == "VEGETABLE_SELECTION":
        # 매우 단순 룰: "빼고", "전부", "추가", "만"
        ops = []
        if "전부" in t or "모두" in t: ops.append("ALL")
        if "빼" in t or "제외" in t: ops.append("EXCLUDE")
        if "추가" in t or "넣어" in t: ops.append("ADD")
        if "만" in t: ops.append("ONLY")
        # 재료 토큰 예시(추후 DB 연동 시 사전 대체)
        ingredients = ["양파","할라피뇨","피클","토마토","올리브","렌치","머스타드","마요","스위트어니언"]
        found = [ing for ing in ingredients if ing in t]
        return {"intent":"SET_INGREDIENTS","slots":{"ops":ops,"items":found}}

    return {"intent":"NONE","slots":{}}


@app.get("/menus/popular")
def get_popular_menus(limit: int = 10, db: Session = Depends(get_db)):
    rows = db.query(Menu).order_by(Menu.popular_rank.asc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "image_url": r.image_url,
            "price_cents": r.price_cents,
            "price_15_cents": r.price_15_cents,
            "price_30_cents": r.price_30_cents,
            "popular_rank": r.popular_rank,
        }
        for r in rows
    ]

@app.get("/ingredients")
def list_ingredients(db: Session = Depends(get_db)):
    rows = db.query(Ingredient).order_by(Ingredient.id.asc()).all()
    return [
        {"id": r.id, "name": r.name, "type": r.type or "unknown"}
        for r in rows
    ]

@app.get("/ingredients/names")
def list_ingredient_names(db: Session = Depends(get_db)):
    rows = db.query(Ingredient.name).order_by(Ingredient.id.asc()).all()
    return [r[0] for r in rows]


@app.post("/nlu_llm")
def nlu_llm(payload: dict = Body(...)):
    """
    payload:
    {
      "text": "3번 주세요",
      "context": "MAIN_MENU",
      "menu_count": 10,
      "known_ingredients": ["양파","할라피뇨","피클","토마토","올리브","렌치","머스타드","마요","스위트어니언"]
    }
    """
    text = (payload.get("text") or "").strip()
    context = payload.get("context") or ""
    menu_count = int(payload.get("menu_count") or 10)
    known_ingredients = payload.get("known_ingredients") or []

    if not text:
        return {"intent":"NONE","slots":{},"confidence":0.0}

    SYSTEM = (
        "You are a strict NLU for a kiosk. "
        "Output MUST be valid JSON following the provided schema. "
        "Map Korean speech to intents and slots. "
        "If user says cancel/stop/home (e.g., '취소','그만','홈으로','주문 취소'), return intent=CANCEL_ORDER. "
        "If user answers confirmation like '예/네/응', return CONFIRM_YES; if '아니오/아니', return CONFIRM_NO. "
        "If menu number exceeds available range, still return SELECT_MENU but without menu_number. "
        "Ingredients must be chosen only from known_ingredients. "
        "Ops: ADD(추가/넣어), EXCLUDE(빼/제외), ALL(전부/모두), ONLY(~만). "
        "If unclear, return intent=NONE with low confidence."
    )

    USER = json.dumps({
        "text": text,
        "context": context,
        "menu_count": menu_count,
        "known_ingredients": known_ingredients
    }, ensure_ascii=False)

    try:
        # gpt-4o-mini 계열 권장 (속도/비용)
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role":"system","content":SYSTEM},
                {"role":"user","content":USER},
            ],
            # JSON 스키마 강제
            response_format={
                "type":"json_schema",
                "json_schema":KIOSK_NLU_SCHEMA
            },
            temperature=0.2,
        )
        content = completion.choices[0].message.content
        result = json.loads(content)
        # 방어적 보정
        intent = result.get("intent") or "NONE"
        slots = result.get("slots") or {}
        confidence = float(result.get("confidence") or 0.0)

        # 메뉴 번호 범위 보정
        mn = slots.get("menu_number")
        if isinstance(mn, int) and (mn < 1 or mn > menu_count):
            slots.pop("menu_number", None)

        # 재료 화이트리스트 보정
        items = slots.get("items") or []
        if items and known_ingredients:
            slots["items"] = [i for i in items if i in known_ingredients]

        return {"intent": intent, "slots": slots, "confidence": confidence}

    except Exception as e:
        logger.exception("[NLU_LLM] error")
        # 실패 시 룰기반 대비책으로 NONE 반환
        return {"intent":"NONE","slots":{},"confidence":0.0}


# 3.1 주문 생성
@app.post("/orders")
def create_order(db: Session = Depends(get_db)):
    order = Order()
    db.add(order)
    db.commit()
    db.refresh(order)
    return {"order_id": order.id, "status": order.status, "total_cents": order.total_cents}

# 3.2 주문에 메뉴 아이템 추가
@app.post("/orders/{order_id}/items")
def add_order_item(order_id: int, payload: dict = Body(...), db: Session = Depends(get_db)):
    """
    payload 예:
    {
      "menu_id": 3,
      "quantity": 2,
      "size_cm": 15,   # 15 또는 30 (필수)
      "ingredients_ops": { "ADD": ["토마토"], "EXCLUDE": ["양파"] }
    }
    """
    order = db.get(Order, order_id)
    if not order:
      raise HTTPException(404, "order not found")
    if order.status != "PENDING":
      raise HTTPException(400, "order not PENDING")

    menu_id = int(payload.get("menu_id"))
    qty = max(1, int(payload.get("quantity") or 1))
    
    ops = payload.get("ingredients_ops") or {}


    menu = db.get(Menu, menu_id)
    if not menu:
      raise HTTPException(404, "menu not found")

    unit = menu.price_cents or 0  # 단일가 사용
    item = OrderItem(
      order_id=order.id,
      menu_id=menu.id,
      name=menu.name,
      unit_price_cents=unit,      # NEW
      quantity=qty,
      size_cm=None,            # NEW
    )
    db.add(item)
    db.flush()

    for action in ("ADD", "EXCLUDE"):
      for ing in ops.get(action) or []:
        db.add(OrderItemIngredient(order_item_id=item.id, ingredient_name=ing, action=action))

    # 합계 재계산(권장: 항상 서버가 계산)
    order.total_cents = _recalc_total(order)

    db.commit()
    db.refresh(order)
    db.refresh(item)

    return {
      "order_id": order.id,
      "total_cents": order.total_cents,
      "item": {
        "id": item.id,
        "menu_id": item.menu_id,
        "name": item.name,
        "size_cm": item.size_cm,
        "unit_price_cents": item.unit_price_cents,
        "quantity": item.quantity,
        "ingredients_ops": ops
      }
    }

# 3.3 영수증(결제 전 미리보기)
@app.get("/orders/{order_id}")
def get_order(order_id: int, db: Session = Depends(get_db)):
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(404, "order not found")

    items_out = []
    for it in order.items:
        ops = {"ADD": [], "EXCLUDE": []}
        for ing in it.ingredients:
            ops[ing.action].append(ing.ingredient_name)
        items_out.append({
            "id": it.id,
            "menu_id": it.menu_id,
            "name": it.name,
            "unit_price_cents": it.unit_price_cents,
            "size_cm": it.size_cm,
            "quantity": it.quantity,
            "ingredients_ops": ops
        })

    return {
        "order_id": order.id,
        "status": order.status,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "total_cents": order.total_cents,
        "items": items_out
    }

# 3.4 주문 확정(결제 직전/직후 마킹)
@app.post("/orders/{order_id}/confirm")
def confirm_order(order_id: int, db: Session = Depends(get_db)):
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(404, "order not found")
    if order.status != "PENDING":
        raise HTTPException(400, "order not PENDING")

    order.status = "CONFIRMED"
    db.commit()
    return {"order_id": order.id, "status": order.status}

# 3.5 주문 취소
@app.post("/orders/{order_id}/cancel")
def cancel_order(order_id: int, db: Session = Depends(get_db)):
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(404, "order not found")

    order.status = "CANCELLED"
    db.commit()
    return {"order_id": order.id, "status": order.status}


@app.patch("/orders/{order_id}/items/{item_id}")
def update_order_item(order_id: int, item_id: int, payload: dict = Body(...), db: Session = Depends(get_db)):
    """
    payload 예시:
    { "op": "inc", "delta": 1 }    # +1
    { "op": "dec", "delta": 1 }    # -1, 최소 1로 바인딩
    { "op": "set", "quantity": 3 } # 직접 설정(최소 1)
    """
    order = db.get(Order, order_id)
    if not order: raise HTTPException(404, "order not found")
    if order.status != "PENDING": raise HTTPException(400, "order not PENDING")

    item = db.get(OrderItem, item_id)
    if not item or item.order_id != order_id:
      raise HTTPException(404, "order item not found")

    op = (payload.get("op") or "").lower()
    if op == "inc":
      delta = int(payload.get("delta") or 1)
      item.quantity = max(1, (item.quantity or 1) + delta)
    elif op == "dec":
      delta = int(payload.get("delta") or 1)
      item.quantity = max(1, (item.quantity or 1) - delta)
    elif op == "set":
      q = int(payload.get("quantity") or 1)
      item.quantity = max(1, q)
    else:
      raise HTTPException(400, "invalid op")

    # 합계 재계산
    order.total_cents = _recalc_total(order)

    db.commit()
    db.refresh(order)
    db.refresh(item)
    return { "order_id": order.id, "item_id": item.id, "quantity": item.quantity, "total_cents": order.total_cents }

@app.delete("/orders/{order_id}/items/{item_id}")
def delete_order_item(order_id: int, item_id: int, db: Session = Depends(get_db)):
    order = db.get(Order, order_id)
    if not order: raise HTTPException(404, "order not found")
    if order.status != "PENDING": raise HTTPException(400, "order not PENDING")

    item = db.get(OrderItem, item_id)
    if not item or item.order_id != order_id:
      raise HTTPException(404, "order item not found")

    db.delete(item)
    db.flush()

    # 합계 재계산
    order.total_cents = _recalc_total(order)

    db.commit()
    db.refresh(order)
    return { "order_id": order.id, "total_cents": order.total_cents }
