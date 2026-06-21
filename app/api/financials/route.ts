import { NextResponse } from "next/server";
import { kisGet } from "@/lib/kis";
import { storeGet, storeSet } from "@/lib/store";

// 국내주식 손익계산서 — 매출/순이익을 분기·연간으로(각 실제 3 + 예측 1).
// 예측: 아래 MANUAL_FORECAST에 값을 넣으면 그걸 쓰고, 비우면 자동 추정(전기 대비 성장률).
// 저장소 캐시(6시간). ?force=1 이면 새로 받아 저장.
export const dynamic = "force-dynamic";
const PATH = "/uapi/domestic-stock/v1/finance/income-statement";
const TR = "FHKST66430200";
const TTL = 21600;

// ✏️ 예측 수동 입력(억원). 비우면 자동추정. 예:
//   "005930": { q: { revenue: 760000, netIncome: 90000 }, y: { revenue: 3100000, netIncome: 380000 } }
// 2026 예측 (증권사 컨센서스, 단위: 억원). q = 2026 2분기, y = 2026 연간.
// 영업이익은 컨센서스 공표치, 순이익·일부 매출은 영업이익에서 환산한 추정.
//  삼성: 순이익 ≈ 영업이익×0.8 / 하이닉스: 순이익 ≈ 영업이익(순현금 금융수익으로 비슷)
const MANUAL_FORECAST: Record<
  string,
  { q?: { revenue?: number; netIncome?: number }; y?: { revenue?: number; netIncome?: number } }
> = {
  "005930": {
    q: { revenue: 1650000, netIncome: 690000 },  // 2026 2Q: 매출 ~165조 / 순이익 ~69조 (영업이익 ~85조)
    y: { revenue: 6000000, netIncome: 2900000 }, // 2026 연간: 매출 ~600조 / 순이익 ~290조 (영업이익 ~366조)
  },
  "000660": {
    q: { revenue: 780000, netIncome: 600000 },   // 2026 2Q: 매출 ~78조 / 순이익 ~60조
    y: { revenue: 3200000, netIncome: 2650000 }, // 2026 연간: 매출 ~320조 / 순이익 ~265조 (영업이익 ~268조)
  },
};

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 전기 대비 성장률로 다음 값 추정 (±40% 제한)
function estimate(chrono: (number | null)[]): number | null {
  const vals = chrono.filter((x): x is number => typeof x === "number");
  if (vals.length === 0) return null;
  const last = vals[vals.length - 1];
  if (vals.length >= 2) {
    const prev = vals[vals.length - 2];
    const g = prev ? (last - prev) / Math.abs(prev) : 0;
    const gc = Math.max(-0.4, Math.min(0.4, g));
    return Math.round(last * (1 + gc));
  }
  return last;
}

function nextQuarter(yymm: string): string {
  const y = +yymm.slice(0, 4), m = +yymm.slice(4, 6);
  const map: Record<number, string> = { 3: "06", 6: "09", 9: "12", 12: "03" };
  const nm = map[m] || "03";
  const ny = m === 12 ? y + 1 : y;
  return `${ny}${nm}`;
}
function nextYear(yymm: string): string {
  return `${+yymm.slice(0, 4) + 1}12`;
}

async function fetchFinancials(code: string) {
  const base = { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code };
  const [annualRes, quarterRes] = await Promise.all([
    kisGet(PATH, TR, { ...base, FID_DIV_CLS_CODE: "0" }), // 연간
    kisGet(PATH, TR, { ...base, FID_DIV_CLS_CODE: "1" }), // 분기
  ]);

  const parse = (rows: any[]) =>
    (rows || [])
      .map((r) => ({
        period: String(r.stac_yymm || ""),
        revenue: toNum(r.sale_account),
        netIncome: toNum(r.thtr_ntin),
      }))
      .filter((x) => x.period);

  // KIS는 최신순 → 과거순으로 뒤집기
  const qRows = parse(quarterRes.output).reverse(); // oldest..newest
  const aRows = parse(annualRes.output).reverse();

  const qActual = qRows.slice(-3); // 최근 3분기 실제
  // 연간 실제는 '완료된 연도'만 (현재연도=올해는 1분기까지만 누적이라 실제가 아니라 예측 대상)
  const curY = new Date().getFullYear();
  const aActual = aRows.filter((r) => +r.period.slice(0, 4) < curY).slice(-3);

  const man = MANUAL_FORECAST[code] || {};
  const lastQ = qActual[qActual.length - 1];
  const lastA = aActual[aActual.length - 1];

  const qForecast = lastQ
    ? {
        period: nextQuarter(lastQ.period),
        revenue: man.q?.revenue ?? estimate(qActual.map((x) => x.revenue)),
        netIncome: man.q?.netIncome ?? estimate(qActual.map((x) => x.netIncome)),
        forecast: true,
      }
    : null;
  const aForecast = lastA
    ? {
        period: nextYear(lastA.period),
        revenue: man.y?.revenue ?? estimate(aActual.map((x) => x.revenue)),
        netIncome: man.y?.netIncome ?? estimate(aActual.map((x) => x.netIncome)),
        forecast: true,
      }
    : null;

  const quarterly = [
    ...qActual.map((x) => ({ ...x, forecast: false })),
    ...(qForecast ? [qForecast] : []),
  ];
  const annual = [
    ...aActual.map((x) => ({ ...x, forecast: false })),
    ...(aForecast ? [aForecast] : []),
  ];

  // trailing PER용: 최근 4분기 실제 순이익 합 / forward PER용: 연간 예측 순이익
  const last4 = qRows.slice(-4).map((x) => x.netIncome).filter((x): x is number => typeof x === "number");
  const ttmNet = last4.length === 4 ? last4.reduce((s, v) => s + v, 0) : null;
  const forwardNet = aForecast ? aForecast.netIncome : null;

  return {
    code,
    quarterly,
    annual,
    ttmNet,
    forwardNet,
    // 상단 PER 등 하위호환용
    period: lastA?.period || null,
    revenue: lastA?.revenue ?? null,
    netIncome: lastA?.netIncome ?? null,
  };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const code = sp.get("code") || "005930";
  const force = sp.get("force") === "1";

  const key = `fin4:${code}`;
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
