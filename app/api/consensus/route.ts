import { NextResponse } from "next/server";
import { kisGet, num } from "@/lib/kis";
import { storeGet, storeSet } from "@/lib/store";

// 증권가 컨센서스: 국내주식 종목투자의견(invest-opinion, FHKST663300C0)에서
// 최근 6개월 증권사별 투자의견·목표주가를 모아 평균 목표가 / 매수·보유·매도 수를 낸다.
// (KIS 응답 형태가 다를 수 있어 best-effort. 데이터 없으면 count:0 으로 빈 상태 처리)
export const dynamic = "force-dynamic";
const TTL = 21600; // 6시간

function yyyymmdd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function classify(opnn: string): "buy" | "hold" | "sell" {
  const s = (opnn || "").toLowerCase();
  if (/(매도|축소|비중축소|reduce|sell|underweight)/.test(s)) return "sell";
  if (/(매수|적극|비중확대|확대|buy|overweight|strong)/.test(s)) return "buy";
  return "hold"; // 중립·보유·유지·hold 등
}

async function fetchConsensus(code: string) {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 6);

  const data = await kisGet(
    "/uapi/domestic-stock/v1/quotations/invest-opinion",
    "FHKST663300C0",
    {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_COND_SCR_DIV_CODE: "16633",
      FID_INPUT_ISCD: code,
      FID_INPUT_DATE_1: yyyymmdd(start),
      FID_INPUT_DATE_2: yyyymmdd(end),
    }
  );

  const rows: any[] = data.output || [];
  // 증권사(mbcr_name)별 최신 의견만 사용 (rows는 최신순 가정 → 처음 등장한 것 유지)
  const byFirm = new Map<string, any>();
  for (const r of rows) {
    const firm = String(r.mbcr_name || "").trim();
    if (!firm) continue;
    if (!byFirm.has(firm)) byFirm.set(firm, r);
  }
  const recs = [...byFirm.values()];

  let buy = 0, hold = 0, sell = 0, sum = 0, cnt = 0;
  for (const r of recs) {
    const c = classify(String(r.invt_opnn || ""));
    if (c === "buy") buy++;
    else if (c === "sell") sell++;
    else hold++;
    const tp = num(r.hts_goal_prc);
    if (tp > 0) {
      sum += tp;
      cnt++;
    }
  }

  // 증권사별 상세 목록(최신순) — 클릭 시 펼쳐서 보여줌
  const items = recs
    .map((r) => ({
      date: String(r.stck_bsop_date || ""),       // YYYYMMDD
      broker: String(r.mbcr_name || "").trim(),    // 증권사명
      opinion: String(r.invt_opnn || "").trim(),   // 투자의견
      opinionClass: classify(String(r.invt_opnn || "")),
      target: num(r.hts_goal_prc) || null,         // 목표주가
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    code,
    count: recs.length,
    buy,
    hold,
    sell,
    avgTarget: cnt > 0 ? Math.round(sum / cnt) : null,
    items,
  };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const code = sp.get("code") || "005930";
  const force = sp.get("force") === "1";

  const key = `cons2:${code}`;
  if (!force) {
    const cached = await storeGet(key);
    if (cached) return NextResponse.json(cached);
  }
  try {
    const result = await fetchConsensus(code);
    await storeSet(key, result, TTL);
    return NextResponse.json(result);
  } catch (e: any) {
    // 실패해도 화면은 빈 상태로 처리되게
    return NextResponse.json({ code, count: 0, buy: 0, hold: 0, sell: 0, avgTarget: null, items: [], error: e.message });
  }
}
