'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OrderItem } from '../types';

export default function Payment() {
  const router = useRouter();
  const [cart, setCart] = useState<OrderItem[]>([]);

  useEffect(() => {
    const data = sessionStorage.getItem('orderData');
    if (data) {
      setCart(JSON.parse(data));
    } else {
      router.push('/');
    }
  }, [router]);

  const calculateTotal = () => {
    // 간단한 가격 계산 (시연용)
    return cart.reduce((sum, item) => sum + (5000 * item.quantity), 0);
  };

  const handlePayment = () => {
    alert('결제가 완료되었습니다!');
    sessionStorage.removeItem('orderData');
    router.push('/');
  };

  if (cart.length === 0) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-3xl font-bold mb-8 text-center">결제</h1>
        
        <div className="space-y-4 mb-8">
          {cart.map((item, idx) => (
            <div key={idx} className="flex justify-between items-start p-4 bg-gray-50 rounded">
              <div className="flex-1">
                <div className="font-bold text-lg">{item.menu}</div>
                <div className="text-sm text-gray-600 mt-1">
                  <div>빵: {item.bread}</div>
                  {item.cheese && <div>치즈: {item.cheese}</div>}
                </div>
                {item.vegetables.length > 0 && (
                  <div className="text-xs text-gray-500 mt-1">
                    야채: {item.vegetables.join(', ')}
                  </div>
                )}
                {item.sauces.length > 0 && (
                  <div className="text-xs text-gray-500">
                    소스: {item.sauces.join(', ')}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold">
                  {(5000 * item.quantity).toLocaleString()}원
                </div>
                <div className="text-sm text-gray-600">x{item.quantity}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t pt-4 mb-8">
          <div className="flex justify-between items-center text-2xl font-bold">
            <span>총 금액</span>
            <span className="text-green-600">{calculateTotal().toLocaleString()}원</span>
          </div>
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => router.back()}
            className="flex-1 py-4 bg-gray-200 text-gray-800 rounded-lg font-bold hover:bg-gray-300"
          >
            뒤로
          </button>
          <button
            onClick={handlePayment}
            className="flex-1 py-4 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700"
          >
            결제하기
          </button>
        </div>
      </div>
    </div>
  );
}
