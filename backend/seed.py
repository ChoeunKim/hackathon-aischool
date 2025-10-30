from .db import SessionLocal
from .models import Menu

def seed():
    db = SessionLocal()
    try:
        items = [
            {"name":"터키 아보카도", "description":"신선한 터키와 아보카도", "image_url":"", "price_cents":6500, "popular_rank":1},
            {"name":"스테이크 치즈", "description":"육즙 가득 스테이크", "image_url":"", "price_cents":7200, "popular_rank":2},
            {"name":"치킨 베이컨 랜치", "description":"치킨과 베이컨, 랜치 소스", "image_url":"", "price_cents":7000, "popular_rank":3},
            # ... 필요한 만큼 10개
        ]
        for it in items:
            db.add(Menu(**it))
        db.commit()
    finally:
        db.close()

if __name__ == "__main__":
    seed()
