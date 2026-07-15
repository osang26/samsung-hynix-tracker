import { NextResponse } from "next/server";
import { kisGet, num } from "@/lib/kis";
import { storeGet, storeSet } from "@/lib/store";

export const dynamic = "force-dynamic";

// SK하이닉스 나스닥 ADR 실시간 시세 (SKHY, NASDAQ)
// 7/10 임시티커 SKHYV → 7/13부터 정식 SKHY. 10 ADR = 보통주 1주(전환비율 0.1)
const SYMB = "SKHY";
const TTL = 5; // 5초 캐시(여러 명 동시 접속 시 KIS 부담 완화, 혼자 볼 땐 실시간에 가깝게)

// 미국 장 세션 판단 (뉴욕 시간 기준)
function getSession(): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const mins = hour * 60 + parseInt(get("minute"), 10);

  const PRE = 4 * 60, REG = 9 * 60 + 30, REG_END = 16 * 60, AFT_END = 20 * 60;

  if (weekday === "Sat") return "closed";
  if (weekday === "Sun") return mins >= AFT_END ? "daymarket" : "closed";
  if (weekday === "Fri" && mins >= AFT_END) return "closed";
  if (mins >= PRE && mins < REG) return "premarket";
  if (mins >= REG && mins < REG_END) return "regular";
  if (mins >= REG_END && mins < AFT_END) return "afterhours";
  return "daymarket";
}

// 나스닥: 일반 세션 NAS, 데이마켓(야간 연장거래) BAQ
function getExcd(session: string): string {
  return session === "daymarket" ? "BAQ" : "NAS";
}

export async function GET() {
  const session = getSession();
  const key = `adr:${SYMB}`;

  const cached = (await storeGet(key)) as any;
  if (cached && cached.session === session) return NextResponse.json(cached);

  try {
    const excd = getExcd(session);
    const data = await kisGet(
      "/uapi/overseas-price/v1/quotations/price-detail",
      "HHDFS76200200",
      { AUTH: "", EXCD: excd, SYMB }
    );
    const o = data.output || {};
    const last = num(o.last);
    const base = num(o.base); // 전일 종가

    const result = {
      symbol: SYMB,
      session,
      available: session !== "closed" && last > 0,
      price: last > 0 ? last : null,
      base: base > 0 ? base : null,
      change: base > 0 ? Math.round((last - base) * 100) / 100 : 0,
      changeRate: base > 0 ? Math.round(((last - base) / base) * 10000) / 100 : 0,
      updatedAt: new Date().toISOString(),
    };

    await storeSet(key, result, TTL);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { symbol: SYMB, session, available: false, price: null, error: e?.message || "조회 실패" },
      { status: 200 }
    );
  }
}
