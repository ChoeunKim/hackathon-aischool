from sqlalchemy import Column, Integer, String, Text, ForeignKey, TIMESTAMP, func
from datetime import datetime
from sqlalchemy.orm import relationship, Mapped, mapped_column
from db import Base

class Menu(Base):
    __tablename__ = "menus"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    price_cents: Mapped[int | None] = mapped_column(Integer)       # 과거 호환
    popular_rank: Mapped[int | None] = mapped_column(Integer)
    price_15_cents: Mapped[int | None] = mapped_column(Integer)    # NEW
    price_30_cents: Mapped[int | None] = mapped_column(Integer)    # NEW

class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    total_cents: Mapped[int] = mapped_column(Integer, default=0)

    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")

class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    menu_id: Mapped[int] = mapped_column(ForeignKey("menus.id"))
    name: Mapped[str] = mapped_column(String(100))
    #price_cents: Mapped[int] = mapped_column(Integer, default=0)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    size_cm: Mapped[int | None] = mapped_column(Integer)           # NEW
    unit_price_cents: Mapped[int | None] = mapped_column(Integer)  # NEW


    order: Mapped[Order] = relationship(back_populates="items")
    ingredients: Mapped[list["OrderItemIngredient"]] = relationship(
        back_populates="order_item", cascade="all, delete-orphan"
    )

class OrderItemIngredient(Base):
    __tablename__ = "order_item_ingredients"
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), primary_key=True
    )
    ingredient_name: Mapped[str] = mapped_column(String(50), primary_key=True)
    action: Mapped[str] = mapped_column(String(10), primary_key=True)  # ADD | EXCLUDE

    order_item: Mapped[OrderItem] = relationship(back_populates="ingredients")

class Ingredient(Base):
    __tablename__ = "ingredients"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    type: Mapped[str | None] = mapped_column(String, default="unknown")