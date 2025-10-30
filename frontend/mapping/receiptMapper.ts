// frontend/mapping/receiptMapper.ts
// 목적: 다양한 백엔드 응답 변형을 수용하여 프런트 내부 공통 스키마로 변환

// -----------------------------
// 1) 프런트 공통 타입(내부 기준)
// -----------------------------
export type IngredientOps = {
  ADD: string[];
  EXCLUDE: string[];
};

export type FrontOrderItem = {
  id: number;                 // item 식별자 (필수)
  menu_id: number;            // 메뉴 식별자
  name: string;               // 메뉴명 (백엔드가 set)
  size_cm: 15 | 30;           // 사이즈
  quantity: number;           // 수량
  unit_price_cents: number;   // 단가 (15/30cm 기준)
  ingredients_ops: IngredientOps; // {ADD:[], EXCLUDE:[]}
};

export type FrontReceipt = {
  order_id: number;
  status: "PENDING" | "CONFIRMED" | "CANCELLED";
  created_at?: string | null;
  total_cents: number;        // 합계
  items: FrontOrderItem[];    // 라인 아이템들
};

// -----------------------------
// 2) 백엔드 응답 형태(가능성 포함)
// -----------------------------
type BEOrderItemMaybe = {
  id?: number;
  menu_id?: number;
  name?: string;
  size_cm?: number;
  quantity?: number;
  unit_price_cents?: number | null;
  price_cents?: number | null;  // 호환용으로 내려올 수도 있음
  ingredients_ops?: IngredientOps;
  // (과거/변형 필드가 있어도 무시)
};

type BEReceiptMaybe = {
  order_id?: number;
  status?: string;
  created_at?: string | null;
  total_cents?: number | null;
  // 대표적으로 두 가지 키 중 하나일 가능성
  items?: BEOrderItemMaybe[];
  order_items?: BEOrderItemMaybe[];
  // 혹시 data 래핑되는 경우도 대비
  data?: {
    items?: BEOrderItemMaybe[];
  };
};

// -----------------------------
// 3) 안전한 배열 추출 유틸
// -----------------------------
function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// -----------------------------
// 4) 단일 아이템 정규화
// -----------------------------
function normalizeItem(raw: BEOrderItemMaybe, idxFallback = 0): FrontOrderItem {
  // id, menu_id, name 등은 백엔드에서 보장됨 (main.py의 응답 생성 참고)
  // - add_order_item: 반환 item 필드 세트
  // - get_order: items_out 구성 시 모든 키를 채워서 반환
  // 참조: /orders/{order_id}에서 items_out 구성 및 unit_price_cents/size_cm/ingredients_ops 포함. :contentReference[oaicite:2]{index=2}

  const id = Number(raw.id ?? idxFallback);
  const menu_id = Number(raw.menu_id ?? 0);
  const name = String(raw.name ?? "");
  const size_cmRaw = Number(raw.size_cm ?? 15);
  const size_cm = (size_cmRaw === 30 ? 30 : 15) as 15 | 30;

  const quantity = Math.max(1, Number(raw.quantity ?? 1));

  // 단가는 unit_price_cents 우선, 없으면 price_cents 사용(백엔드에서 호환용 필드도 내려줌)
  const unit_price_cents =
    Number(raw.unit_price_cents ?? NaN) ||
    Number(raw.price_cents ?? NaN) ||
    0;

  // 재료 연산자 기본값 보정
  const ops = raw.ingredients_ops ?? { ADD: [], EXCLUDE: [] };
  const ingredients_ops: IngredientOps = {
    ADD: asArray<string>(ops.ADD),
    EXCLUDE: asArray<string>(ops.EXCLUDE),
  };

  return {
    id,
    menu_id,
    name,
    size_cm,
    quantity,
    unit_price_cents,
    ingredients_ops,
  };
}

// -----------------------------
// 5) 영수증 정규화의 핵심
// -----------------------------
export function normalizeReceipt(resp: BEReceiptMaybe): FrontReceipt {
  // 아이템 소스 선택 우선순위:
  //   items -> order_items -> data.items
  const candidates = [
    resp?.items,
    resp?.order_items,
    resp?.data?.items,
  ];

  const rawItems = candidates.find((c) => Array.isArray(c)) as BEOrderItemMaybe[] | undefined;
  const items = asArray<BEOrderItemMaybe>(rawItems);

  const normalizedItems = items.map((it, i) => normalizeItem(it, i + 1));

  const order_id = Number(resp?.order_id ?? 0);
  const statusRaw = String(resp?.status ?? "PENDING").toUpperCase();
  const status =
    statusRaw === "CONFIRMED" ? "CONFIRMED" :
    statusRaw === "CANCELLED" ? "CANCELLED" :
    "PENDING";

  const total_cents = Number(resp?.total_cents ?? 0);

  return {
    order_id,
    status,
    created_at: resp?.created_at ?? null,
    total_cents,
    items: normalizedItems,
  };
}

// -----------------------------
// 6) fetch + 매핑 예시 (React 헬퍼)
// -----------------------------
export async function fetchAndNormalizeReceipt(orderId: number): Promise<FrontReceipt> {
  const r = await fetch(`http://localhost:8000/orders/${orderId}`, {
    method: "GET",
  });
  if (!r.ok) throw new Error(`GET /orders/${orderId} failed: ${r.status}`);
  const json = (await r.json()) as BEReceiptMaybe;
  return normalizeReceipt(json);
}

// -----------------------------
// 7) 주문 플로우 예시 (추가 아이템 등록 → 영수증 재조회)
// -----------------------------
type AddItemPayload = {
  menu_id: number;
  quantity: number;
  ingredients_ops?: IngredientOps;
};

export async function addItemAndRefresh(orderId: number, payload: AddItemPayload): Promise<FrontReceipt> {
  // POST /orders/{id}/items 호출 시 서버가 name, unit_price_cents, size_cm, quantity 등을 저장
  // 참고: add_order_item 구현 및 단가 계산/size_cm 검증 로직. :contentReference[oaicite:3]{index=3}

  const r1 = await fetch(`http://localhost:8000/orders/${orderId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r1.ok) throw new Error(`POST /orders/${orderId}/items failed: ${r1.status}`);

  // 서버 합계 재계산 후, GET으로 수령(결제 전 미리보기 겸용)
  const r2 = await fetch(`http://localhost:8000/orders/${orderId}`, { method: "GET" });
  if (!r2.ok) throw new Error(`GET /orders/${orderId} failed: ${r2.status}`);
  const json = (await r2.json()) as BEReceiptMaybe;
  return normalizeReceipt(json);
}

// -----------------------------
// 8) 결제 단계 표시 예시(렌더링 스니펫)
// -----------------------------
export function formatKRW(cents: number): string {
  // 백엔드는 원 단위를 "cents"처럼 사용하므로, 필요 시 변환 규칙에 맞게 포맷
  // 예: 서버가 5900을 "원" 의미로 싣는다면 그대로 사용
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW" })
    .format(cents);
}

/* React 컴포넌트에서 사용 예시)

const [receipt, setReceipt] = useState<FrontReceipt | null>(null);

useEffect(() => {
  fetchAndNormalizeReceipt(orderId).then(setReceipt).catch(console.error);
}, [orderId]);

...

{receipt?.items?.length ? (
  <ul>
    {receipt.items.map(it => (
      <li key={it.id}>
        {it.name} ({it.size_cm}cm) x {it.quantity} — {formatKRW(it.unit_price_cents * it.quantity)}
        { (it.ingredients_ops.ADD.length || it.ingredients_ops.EXCLUDE.length) ? (
          <div className="text-xs text-gray-500">
            {it.ingredients_ops.ADD.length ? `추가: ${it.ingredients_ops.ADD.join(", ")}` : ""}
            {it.ingredients_ops.EXCLUDE.length ? ` / 제외: ${it.ingredients_ops.EXCLUDE.join(", ")}` : ""}
          </div>
        ) : null}
      </li>
    ))}
  </ul>
) : (
  <div>장바구니가 비어 있습니다.</div>
)}

<div className="mt-4 font-semibold">
  합계: {formatKRW(receipt?.total_cents ?? 0)}
</div>

*/
