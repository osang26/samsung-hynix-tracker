import { NextResponse } from "next/server";
import { kisGet, num } from "@/lib/kis";
import { storeGet, storeSet } from "@/lib/store";

// 차트: 기간(range)에 따라 봉 종류를 바꿔서 KIS 시세를 받아온다.
//  1일 → 분봉(NXT 포함, 통합시세 UN, 08:00~20:00) / 1주·1달·3달 → 일봉 / 1년 → 주봉
// 저장소(Upstash)에 캐시해두고 페이지는 저장소에서 읽는다. ?force=1 이면 새로 받아 저장(크론용).
type Range = "1D" | "1W" | "1M" | "3M" | "1Y";

const CFG: Record<
  Range,
  { candle: string; period?: "D" | "W"; days?: number; take: number; ttl: number }
> = {
  "1D": { candle: "분봉", take: 800, ttl: 60 },
  "1W": { candle: "일봉", period: "D", days: 12, take: 7, ttl: 600 },
  "1M": { candle: "일봉", period: "D", days: 45, take: 22, ttl: 3600 },
  "3M": { candle: "일봉", period: "D", days: 130, take: 66, ttl: 3600 },
  "1Y": { candle: "주봉", period: "W", days: 400, take: 52, ttl: 21600 },
};

function yyyymmdd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
function fmtDate(d: string, range: Range): string {
  if (!d || d.length < 8) return d || "";
  const yy = d.slice(2, 4), mm = d.slice(4, 6), dd = d.slice(6, 8);
  if (range === "1Y") return `${yy}.${mm}`;
  return `${mm}/${dd}`;
}
function hm(h: string): string {
  if (!h || h.length < 4) return h || "";
  return h.slice(0, 2) + ":" + h.slice(2, 4);
}
function minus1min(hms: string): string | null {
  if (!hms || hms.length < 6) return null;
  let t = +hms.slice(0, 2) * 3600 + +hms.slice(2, 4) * 60 + +hms.slice(4, 6) - 60;
  if (t < 0) return null;
  const hh = String(Math.floor(t / 3600)).padStart(2, "0");
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return hh + mm + ss;
}

// 1일: 통합시세(UN) 분봉을 20:00부터 08:00까지 거슬러 호출하며 하루치를 모은다.
async function intraday(code: string) {
  const all: any[] = [];
  let hour = "200000"; // NXT 애프터마켓 마감(20:00)부터 거슬러 올라감
  let sessionDate = "";
  let prevEarliest = "";
  for (let i = 0; i < 30; i++) {
    const data = await kisGet(
      "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
      "FHKST03010200",
      {
        FID_ETC_CLS_CODE: "",
        FID_COND_MRKT_DIV_CODE: "UN", // 통합(KRX+NXT) → 프리/애프터 포함
        FID_INPUT_ISCD: code,
        FID_INPUT_HOUR_1: hour,
        FID_PW_DATA_INCU_YN: "Y",
      }
    );
    const rows: any[] = data.output2 || [];
    if (rows.length === 0) break;
    if (!sessionDate) sessionDate = String(rows[0].stck_bsop_date || "");
    all.push(...rows);
    const earliest = String(rows[rows.length - 1].stck_cntg_hour || "");
    if (!earliest || earliest === prevEarliest) break;
    prevEarliest = earliest;
    if (earliest <= "080100") break;
    const next = minus1min(earliest);
    if (!next || next < "080000") break;
    hour = next;
  }

  const seen = new Set<string>();
  const bars: { label: string; close: number; volume: number; t: string }[] = [];
  for (const r of all) {
    const d = String(r.stck_bsop_date || "");
    const t = String(r.stck_cntg_hour || "");
    if (sessionDate && d !== sessionDate) continue;
    if (!t || seen.has(t)) continue;
    if (t < "080000" || t > "200000") continue;
    seen.add(t);
    bars.push({ label: hm(t), close: num(r.stck_prpr), volume: num(r.cntg_vol), t });
  }
  bars.sort((a, b) => (a.t < b.t ? -1 : 1));
  return bars.map(({ label, close, volume }) => ({ label, close, volume }));
}

async function fetchChart(code: string, range: Range) {
  const cfg = CFG[range];
  if (range === "1D") {
    const series = await intraday(code);
    return { code, range, candle: cfg.candle, series };
  }
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (cfg.days || 45));
  const data = await kisGet(
    "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
    "FHKST03010100",
    {
      FID_COND_MRKT_DIV_CODE: "J", // 일봉/주봉은 KRX 기준
      FID_INPUT_ISCD: code,
      FID_INPUT_DATE_1: yyyymmdd(start),
      FID_INPUT_DATE_2: yyyymmdd(end),
      FID_PERIOD_DIV_CODE: cfg.period || "D",
      FID_ORG_ADJ_PRC: "0",
    }
  );
  const rows: any[] = data.output2 || [];
  const series = rows
    .filter((r) => r && r.stck_bsop_date)
    .map((r) => ({
      label: fmtDate(String(r.stck_bsop_date), range),
      close: num(r.stck_clpr),
      volume: num(r.acml_vol),
    }))
    .reverse()
    .slice(-cfg.take);
  return { code, range, candle: cfg.candle, series };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const code = sp.get("code") || "005930";
  const range = (sp.get("range") || "1D") as Range;
  const force = sp.get("force") === "1";
  if (!CFG[range]) return NextResponse.json({ error: "잘못된 기간" }, { status: 400 });

  const key = `chart:${code}:${range}`;
  if (!force) {
    const cached = await storeGet(key);
    if (cached) return NextResponse.json(cached);
  }

  try {
    const result = await fetchChart(code, range);
    await storeSet(key, result, CFG[range].ttl);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "차트 조회 실패" }, { status: 500 });
  }
}
