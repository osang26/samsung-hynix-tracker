import { NextResponse } from "next/server";
import { kisGet, num } from "@/lib/kis";
import { storeGet, storeSet } from "@/lib/store";

// 종목별 공매도 일별추이: KIS daily-short-sale (FHPST04830000).
// 일자별 공매도 거래량·비중(%)·거래대금. 날짜 범위 지원 → 최근 추이를 바로 받아온다.
// 저장소 캐시(1시간). ?force=1 새로 받음. ?debug=1 원본 첫 행 확인.
export const dynamic = "force-dynamic";
const TTL = 3600;

function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

const PATH = "/uapi/domestic-stock/v1/quotations/daily-short-sale";
const TR = "FHPST04830000";

function params(code: string, days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return {
    FID_COND_MRKT_DIV_CODE: "J",
    FID_INPUT_ISCD: code,
    FID_INPUT_DATE_1: ymd(start),
    FID_INPUT_DATE_2: ymd(end),
  };
}

async function fetchShort(code: string) {
  const data = await kisGet(PATH, TR, params(code, 80));
  const rows: any[] = Array.isArray(data.output2)
    ? data.output2
    : Array.isArray(data.output)
    ? data.output
    : data.output1 || [];

  const items = rows
    .filter((r) => r && r.stck_bsop_date)
    .map((r) => {
      const qty = num(r.ssts_cntg_qty);          // 공매도 체결수량(주)
      const close = num(r.stck_clpr);             // 종가
      // 공매도 거래량 비중(%) — 필드 있으면 사용, 없으면 전체거래량으로 계산
      let ratio = num(r.ssts_vol_rlim);
      if (!ratio) {
        const tot = num(r.whol_smtn_vol) || num(r.stnd_vol) || num(r.acml_vol);
        if (tot > 0) ratio = (qty / tot) * 100;
      }
      return {
        date: String(r.stck_bsop_date),
        qty,
        amt: qty * close,                          // 공매도 거래대금(원) = 수량×종가
        ratio: Math.round(ratio * 100) / 100,      // %
      };
    })
    .slice(0, 30); // 최근 30거래일(최신순)

  return { code, items };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const code = sp.get("code") || "005930";
  const force = sp.get("force") === "1";

  if (sp.get("debug") === "1") {
    try {
      const raw = await kisGet(PATH, TR, params(code, 20));
      const rows = Array.isArray(raw.output2) ? raw.output2 : raw.output || raw.output1 || [];
      return NextResponse.json({ sample: rows[0] ?? null, count: rows.length });
    } catch (e: any) {
      return NextResponse.json({ error: e.message });
    }
  }

  const key = `short:${code}`;
  if (!force) {
    const cached = await storeGet(key);
    if (cached) return NextResponse.json(cached);
  }
  try {
    const result = await fetchShort(code);
    await storeSet(key, result, TTL);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ code, items: [], error: e.message });
  }
}
