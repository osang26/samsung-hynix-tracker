import { NextResponse } from "next/server";
import { kisGet, num } from "@/lib/kis";
import { storeGet, storeSet } from "@/lib/store";

export const dynamic = "force-dynamic";

// 현재가는 '실시간'이라 직접 호출하되, 4초 캐시로 여러 명이 동시에 봐도 KIS 부담을 줄인다.
// (혼자 볼 땐 5초 폴링 > 4초 캐시라 매번 새 값 = 실시간)
const TTL = 4;

// 국내주식 현재가 시세 (tr_id: FHKST01010100, 통합시세 UN: 프리/애프터 포함)
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") || "005930";
  const key = `quote:${code}`;

  const cached = await storeGet(key);
  if (cached) return NextResponse.json(cached);

  try {
    const data = await kisGet(
      "/uapi/domestic-stock/v1/quotations/inquire-price",
      "FHKST01010100",
      { FID_COND_MRKT_DIV_CODE: "UN", FID_INPUT_ISCD: code }
    );
    const o = data.output || {};
    // prdy_vrss_sign: 1·2 상승, 3 보합, 4·5 하락
    const sign = String(o.prdy_vrss_sign || "3");
    const dir = sign === "1" || sign === "2" ? "up" : sign === "4" || sign === "5" ? "down" : "flat";

    const result = {
      code,
      price: num(o.stck_prpr),
      change: num(o.prdy_vrss),
      changeRate: num(o.prdy_ctrt),
      dir,
      volume: num(o.acml_vol),
      marketCap: num(o.hts_avls),
      per: o.per ?? "-",
      pbr: o.pbr ?? "-",
      eps: o.eps ?? "-",
      high52: num(o.w52_hgpr),
      low52: num(o.w52_lwpr),
    };

    await storeSet(key, result, TTL);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "조회 실패" }, { status: 500 });
  }
}
