import { NextResponse } from "next/server";
import { kisGet, num } from "@/lib/kis";
import { storeGet, storeSet } from "@/lib/store";

// 종목별 투자자매매동향: 외국인·기관·개인의 '순매수' 수량/거래대금을 일자별로.
// KIS inquire-investor (FHKST01010900). 당일 데이터는 장 마감 후 제공.
// 저장소 캐시(1시간). ?force=1 이면 새로 받아 저장(크론용).
export const dynamic = "force-dynamic";
const TTL = 3600; // 1시간

async function fetchInvestor(code: string) {
  const data = await kisGet(
    "/uapi/domestic-stock/v1/quotations/inquire-investor",
    "FHKST01010900",
    { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code }
  );
  // 응답 형태가 환경에 따라 output / output1 / output2 일 수 있어 모두 대비
  const rows: any[] = Array.isArray(data.output)
    ? data.output
    : data.output1 || data.output2 || [];

  const items = rows
    .filter((r) => r && r.stck_bsop_date)
    .map((r) => ({
      date: String(r.stck_bsop_date),        // YYYYMMDD
      // 순매수 수량(주) — 양수=순매수, 음수=순매도
      frgnQty: num(r.frgn_ntby_qty),
      orgnQty: num(r.orgn_ntby_qty),
      prsnQty: num(r.prsn_ntby_qty),
      // 순매수 거래대금(원)
      frgnAmt: num(r.frgn_ntby_tr_pbmn),
      orgnAmt: num(r.orgn_ntby_tr_pbmn),
      prsnAmt: num(r.prsn_ntby_tr_pbmn),
    }))
    .slice(0, 20); // 최근 20거래일

  return { code, items };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const code = sp.get("code") || "005930";
  const force = sp.get("force") === "1";

  const key = `investor:${code}`;
  if (!force) {
    const cached = await storeGet(key);
    if (cached) return NextResponse.json(cached);
  }
  try {
    const result = await fetchInvestor(code);
    await storeSet(key, result, TTL);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ code, items: [], error: e.message });
  }
}
