import { NextResponse } from "next/server";
import { kisGet } from "@/lib/kis";
import { storeGet, storeSet } from "@/lib/store";

// 국내주식 손익계산서 — 저장소 캐시(6시간). ?force=1 이면 새로 받아 저장(크론용).
const PATH = "/uapi/domestic-stock/v1/finance/income-statement";
const TR = "FHKST66430200";
const TTL = 21600; // 6시간

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchFinancials(code: string) {
  const base = { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code };
  const [annualRes, quarterRes] = await Promise.all([
    kisGet(PATH, TR, { ...base, FID_DIV_CLS_CODE: "0" }), // 연간
    kisGet(PATH, TR, { ...base, FID_DIV_CLS_CODE: "1" }), // 분기
  ]);

  const a = (annualRes.output || [])[0] || {};
  const quarters = (quarterRes.output || [])
    .slice(0, 4)
    .map((r: any) => ({ period: r.stac_yymm || "", netIncome: toNum(r.thtr_ntin) }));

  const haveAll = quarters.length === 4 && quarters.every((q: any) => q.netIncome !== null);
  const ttmNet = haveAll
    ? quarters.reduce((s: number, q: any) => s + (q.netIncome || 0), 0)
    : null;

  return {
    code,
    period: a.stac_yymm || null,
    revenue: toNum(a.sale_account),
    operatingProfit: toNum(a.bsop_prti),
    netIncome: toNum(a.thtr_ntin),
    quarters,
    ttmNet,
  };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const code = sp.get("code") || "005930";
  const force = sp.get("force") === "1";

  const key = `fin:${code}`;
  if (!force) {
    const cached = await storeGet(key);
    if (cached) return NextResponse.json(cached);
  }

  try {
    const result = await fetchFinancials(code);
    await storeSet(key, result, TTL);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "재무 조회 실패" }, { status: 500 });
  }
}
