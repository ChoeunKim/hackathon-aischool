from db import Base, engine
from models import Menu

def init():
    Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    init()
