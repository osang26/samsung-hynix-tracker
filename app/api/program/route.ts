import { NextResponse } from "next/server";
import { kisGet, num } from "@/lib/kis";
import { storeGet, storeSet } from "@/lib/store";

export const dynamic = "force-dynamic";

// 종목별 프로그램매매추이(체결) [v1_국내주식-044]
// tr_id: FHPPG04650101 · output = 시간대별 프로그램 순매수(당일 누적 추정)
// 클라이언트가 5초마다 받아 직전 누적과의 차이(순증)를 계산한다.
const TTL = 3; // 3초 캐시(5초 폴링보다 짧게 → 실시간 diff 유지)

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") || "005930";
  const key = `program:${code}`;

  const cached = (await storeGet(key)) as any;
  if (cached) return NextResponse.json(cached);

  try {
    const data = await kisGet(
      "/uapi/domestic-stock/v1/quotations/program-trade-by-stock",
      "FHPPG04650101",
      { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code }
    );

    const rows: any[] = Array.isArray(data.output) ? data.output : [];
    const timeOf = (r: any) => String(r?.bsop_hour || r?.stck_cntg_hour || r?.stck_bsop_date || "");

    // 최신 시간대 행 (bsop_hour 최대)
    const latest = rows.length
      ? rows.reduce((a, b) => (timeOf(b) >= timeOf(a) ? b : a))
      : null;

    // 전체(차익+비차익) 프로그램 순매수 — 금액/수량 (필드명 후보 방어적 추출)
    const pick = (r: any, keys: string[]) => {
      if (!r) return 0;
      for (const k of keys) if (r[k] != null && r[k] !== "") return num(r[k]);
      return 0;
    };
    const cumAmt = pick(latest, ["whol_ntby_tr_pbmn", "whol_smtn_ntby_tr_pbmn", "pgtr_ntby_tr_pbmn", "arbt_smtm_ntby_tr_pbmn"]);
    const cumQty = pick(latest, ["whol_ntby_qty", "whol_smtn_ntby_qty", "pgtr_ntby_qty", "arbt_smtm_ntby_qty"]);

    const result = {
      code,
      time: latest ? timeOf(latest) : "",
      cumAmt, // 당일 누적 프로그램 순매수 거래대금(원 추정)
      cumQty, // 당일 누적 프로그램 순매수 수량(주)
      rows: rows.length,
      updatedAt: new Date().toISOString(),
    };

    await storeSet(key, result, TTL);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { code, error: e?.message || "조회 실패", cumAmt: null, cumQty: null, time: "" },
      { status: 200 }
    );
  }
}
