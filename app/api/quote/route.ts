import { NextResponse } from "next/server";
import { kisGet, num } from "@/lib/kis";

export const dynamic = "force-dynamic";

// 국내주식 현재가 시세 (tr_id: FHKST01010100)
// 현재가/등락 + 시가총액/PER/PBR/EPS/52주 고저까지 한 번에 줍니다.
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") || "005930";
  try {
    const data = await kisGet(
      "/uapi/domestic-stock/v1/quotations/inquire-price",
      "FHKST01010100",
      { FID_COND_MRKT_DIV_CODE: "UN", FID_INPUT_ISCD: code } // 통합(KRX+NXT): 프리/애프터에도 현재가
    );
    const o = data.output || {};
    // prdy_vrss_sign: 1·2 상승, 3 보합, 4·5 하락
    const sign = String(o.prdy_vrss_sign || "3");
    const dir = sign === "1" || sign === "2" ? "up" : sign === "4" || sign === "5" ? "down" : "flat";

    return NextResponse.json({
      code,
      price: num(o.stck_prpr),          // 현재가
      change: num(o.prdy_vrss),         // 전일 대비
      changeRate: num(o.prdy_ctrt),     // 등락률(%)
      dir,                              // up / down / flat
      volume: num(o.acml_vol),          // 누적 거래량
      marketCap: num(o.hts_avls),       // 시가총액(억원)
      per: o.per ?? "-",
      pbr: o.pbr ?? "-",
      eps: o.eps ?? "-",
      high52: num(o.w52_hgpr),
      low52: num(o.w52_lwpr),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "조회 실패" }, { status: 500 });
  }
}
