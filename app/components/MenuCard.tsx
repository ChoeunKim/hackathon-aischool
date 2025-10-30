"use client";

import Image from "next/image";
import clsx from "clsx";

export type MenuItem = {
  id: number;
  name: string; // 한글
  eng: string; // 영문
  image: string; // /public 기준 경로
  big: string;
  small: string;
};

type Props = {
  item: MenuItem;
  onClick?: (item: MenuItem) => void;
  indexBadge?: number; // 우측 노랑 번호
};

export default function MenuCard({ item, onClick, indexBadge }: Props) {
  return (
    <button
      onClick={() => onClick?.(item)}
      className={clsx(
        "w-full relative rounded-[20px] bg-white shadow-sm hover:shadow-md transition",
        "flex items-center justify-between overflow-hidden"
      )}
      style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.06)" }}
    >
      {/* 본문 */}
      <div className="flex items-center gap-5 px-6">
        <div className="w-[122px] h-[72px] relative">
          <Image
            src={item.image}
            alt={item.name}
            fill
            className="object-contain"
            sizes="120px"
            priority={indexBadge === 1}
          />
        </div>
        <div className="flex flex-col gap-1 text-left">
          <div className="text-[22px] font-semibold">{item.name}</div>
          <div className="text-xs text-gray-400 -mt-1">{item.eng}</div>

          <div className="mt-2 grid grid-cols-2 gap-6 text-[12px]">
            <div>
              <div className="text-[11px] text-green-600">15cm</div>
              <div className="text-[19px] font-medium">{item.small}</div>
            </div>
            <div>
              <div className="text-[11px] text-green-600">30cm</div>
              <div className="text-[19px] font-medium">{item.big}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 우측 노랑 번호 바 */}
      <div
        className="
            shrink-0 w-[88px] min-h-[130px]
            flex items-center justify-center
            text-[64px] font-extrabold
          "
        style={{
          background: "#F4C43A",
          color: "#111",
          borderTopRightRadius: 20,
          borderBottomRightRadius: 20,
        }}
      >
        {indexBadge ?? item.id}
      </div>
    </button>
  );
}
