import { NextResponse } from "next/server";
import { kisGet, num } from "@/lib/kis";
import { storeGet, storeSet } from "@/lib/store";

// 일별 시세 표 (최근 30거래일): 날짜·종가·등락률·거래량·거래대금
// 일봉(KRX)을 받아 표로 가공한다. 저장소 캐시(1시간). ?force=1 이면 새로 받아 저장.
export const dynamic = "force-dynamic";
const TTL = 3600;

function yyyymmdd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
function mmdd(d: string): string {
  if (!d || d.length < 8) return d || "";
  return d.slice(4, 6) + "." + d.slice(6, 8);
}

async function fetchDaily(code: string) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 50); // 30거래일 확보용 여유

  const data = await kisGet(
    "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
    "FHKST03010100",
    {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: code,
      FID_INPUT_DATE_1: yyyymmdd(start),
      FID_INPUT_DATE_2: yyyymmdd(end),
      FID_PERIOD_DIV_CODE: "D",
      FID_ORG_ADJ_PRC: "0",
    }
  );

  const rows: any[] = (data.output2 || []).filter((r: any) => r && r.stck_bsop_date); // 최신순
  const out = [];
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i];
    const close = num(r.stck_clpr);
    const prev = rows[i + 1] ? num(rows[i + 1].stck_clpr) : close; // 다음 행(과거) 종가
    const changeRate = prev ? Math.round(((close - prev) / prev) * 10000) / 100 : 0;
    out.push({
      date: mmdd(String(r.stck_bsop_date)),
      close,
      changeRate,
      volume: num(r.acml_vol),       // 거래량(주)
      amount: num(r.acml_tr_pbmn),   // 거래대금(원)
    });
  }
  return { code, rows: out };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const code = sp.get("code") || "005930";
  const force = sp.get("force") === "1";

  const key = `daily:${code}`;
  if (!force) {
    const cached = await storeGet(key);
    if (cached) return NextResponse.json(cached);
  }
  try {
    const result = await fetchDaily(code);
    await storeSet(key, result, TTL);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "일별시세 조회 실패" }, { status: 500 });
  }
}
