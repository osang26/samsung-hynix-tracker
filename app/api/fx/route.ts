import { NextResponse } from "next/server";
import { storeGet, storeSet } from "@/lib/store";

// 원/달러 환율 자동 조회 — 무료 공개 API(open.er-api.com, 키 불필요). 저장소 캐시 10분.
export const dynamic = "force-dynamic";
const TTL = 600; // 10분
const KEY = "fx:usdkrw";

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!force) {
    const cached = await storeGet(KEY);
    if (cached) return NextResponse.json(cached);
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    const data: any = await res.json();
    const rate = Number(data?.rates?.KRW);
    if (!rate || !Number.isFinite(rate)) throw new Error("환율 데이터 없음");
    const result = {
      rate: Math.round(rate * 100) / 100,
      updated: data?.time_last_update_utc || "",
    };
    await storeSet(KEY, result, TTL);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ rate: null, error: e.message });
  }
}
