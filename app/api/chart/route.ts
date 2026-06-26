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
  "1D": { candle: "분봉", take: 800, ttl: 20 },
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

// 1일: 통합시세(UN) 분봉을 거슬러 호출해 '최근 약 12시간치' 데이터를 모은다.
//  - 폐장 후: 직전 세션(08:00~20:00, 12시간)이 그대로 잡힌다.
//  - 장중: 당일 데이터 + (KIS가 주는 만큼) 전 거래일 저녁 꼬리를 이어 붙여 12시간을 채운다.
//  날짜 경계를 넘어 계속 거슬러 가되, 더 과거가 안 나오면 멈춘다(best-effort, graceful).
const SESSION_MIN = 720; // 08:00~20:00 = 12시간(1분봉 720개)

// 현재 시각(KST) YYYYMMDDHHMMSS
function nowKeyKST(): string {
  const k = new Date(Date.now() + 9 * 3600 * 1000); // UTC+9
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}${p(k.getUTCHours())}${p(k.getUTCMinutes())}${p(k.getUTCSeconds())}`;
}
// '지금(KST)' 이후의 미래 봉(KIS가 격자로 채워 보냄) + 끝의 미체결(거래량 0) 봉 제거
function trimFuture(bars: { d: string; t: string; close: number; volume: number }[]) {
  const nk = nowKeyKST();
  let out = bars.filter((b) => b.d + b.t <= nk);
  if (out.length < 2) out = bars.slice(); // 시계 오차 등으로 다 잘리면 원본
  while (out.length > 1 && (out[out.length - 1].volume || 0) === 0) out.pop();
  return out;
}

async function intradayRaw(code: string) {
  const seen = new Set<string>();
  const bars: { d: string; t: string; close: number; volume: number }[] = [];
  let hour = "200000"; // 애프터마켓 마감(20:00)부터 거슬러 올라감
  let prevMarker = "";

  for (let i = 0; i < 24; i++) {
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
    for (const r of rows) {
      const d = String(r.stck_bsop_date || "");
      const t = String(r.stck_cntg_hour || "");
      if (!d || !t || t < "080000" || t > "200000") continue; // 08:00~20:00만
      const k = d + t;
      if (seen.has(k)) continue;
      seen.add(k);
      bars.push({ d, t, close: num(r.stck_prpr), volume: num(r.cntg_vol) });
    }
    if (bars.length >= SESSION_MIN + 30) break; // 12시간치 충분히 모음
    const last = rows[rows.length - 1];
    const marker = String(last.stck_bsop_date || "") + String(last.stck_cntg_hour || "");
    if (marker === prevMarker) break; // 더 과거 데이터가 안 나오면 중단
    prevMarker = marker;
    const next = minus1min(String(last.stck_cntg_hour || ""));
    if (!next) break;
    hour = next; // 08:00 밑으로도 계속 → 전 거래일 꼬리를 시도
  }

  bars.sort((a, b) => (a.d + a.t < b.d + b.t ? -1 : 1));
  return trimFuture(bars); // '지금'(KST) 이후 미래 봉 + 끝의 미체결 봉 제거
}

// 저장소에 분봉을 누적 병합 → 최근 12시간치(720개)를 반환한다.
//  배포(Upstash): 어제 저장분 + 오늘 실시간이 이어져 '누적 12시간'.
//  로컬(저장소 없음): storeGet/Set이 no-op이라 당일치만 보인다(graceful).
async function mergeIntraday(
  code: string,
  todays: { d: string; t: string; close: number; volume: number }[]
) {
  const KEY = `imin3:${code}`;
  const stored = (await storeGet<any[]>(KEY)) || [];
  const map = new Map<string, { d: string; t: string; close: number; volume: number }>();
  for (const b of stored) if (b && b.d && b.t) map.set(b.d + b.t, b);
  for (const b of todays) map.set(b.d + b.t, b); // 오늘 최신값으로 덮어쓰기
  // 버퍼에도 미래/평평 꼬리가 섞이지 않게 정리한 뒤 저장·반환
  let all = trimFuture([...map.values()].sort((a, b) => (a.d + a.t < b.d + b.t ? -1 : 1)));
  if (all.length > 1500) all = all.slice(-1500); // 최근 ~2거래일치만 보관
  await storeSet(KEY, all, 4 * 24 * 3600); // 4일 보관
  return all.slice(-SESSION_MIN);
}

async function fetchChart(code: string, range: Range) {
  const cfg = CFG[range];
  if (range === "1D") {
    const todays = await intradayRaw(code);
    const merged = await mergeIntraday(code, todays); // 저장소에 누적 병합
    const series = merged.map((b) => ({ label: hm(b.t), close: b.close, volume: b.volume }));
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

  const key = `chart2:${code}:${range}`;
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
