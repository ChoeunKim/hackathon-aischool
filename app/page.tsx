"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import logo from "@/public/img/menu/logo2.png";
import Image from "next/image";
export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-md text-center space-y-8 px-6">
        {/* 로고 */}
        <div className="flex items-center justify-center">
          <Image
            src={logo}
            alt="say&go 로고"
            width={304} // ✅ 이미지 크기 명시
            height={215}
            priority
          />
        </div>

        {/* 버튼 2개 */}
        <div
          style={{ width: "100%", height: "150px" }}
          className="flex flex-col gap-4"
        >
          <Link href="/kiosk" className="btn">
            음성으로 주문하기
          </Link>
          <Link href="/###" className="btn-sub">
            터치로 주문하기
          </Link>
        </div>
      </div>
    </main>
  );
}
