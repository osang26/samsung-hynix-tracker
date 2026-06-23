import { NextResponse } from "next/server";
import { kisGet, num } from "@/lib/kis";
import { storeGet, storeSet } from "@/lib/store";

// 종목별 투자자매매동향: 외국인·기관·개인 순매수(수량/거래대금) 일별.
// KIS inquire-investor (FHKST01010900)는 최근 ~한 달치만 줘서, 저장소에 매일 누적해
// 주/월/년 단위 '누적 순매수(수량, 주)'도 함께 집계한다. 당일치는 장 마감 후 제공.
export const dynamic = "force-dynamic";
const TTL = 3600; // 화면용 결과 캐시 1시간
const BUF_TTL = 400 * 24 * 3600; // 누적 버퍼(크론이 매일 갱신해 유지)

type Day = {
  date: string;
  frgnQty: number; orgnQty: number; prsnQty: number;
  frgnAmt: number; orgnAmt: number; prsnAmt: number;
};

// 그 주의 월요일(YYYYMMDD)
function mondayKey(d: string): string {
  const dt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)));
  const dow = dt.getUTCDay(); // 0=일..6=토
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}${mm}${dd}`;
}

// 기간 키별로 순매수 수량 합산(누적)
function aggregate(rows: Day[], keyOf: (d: string) => string) {
  const map = new Map<string, { key: string; frgn: number; orgn: number; prsn: number }>();
  for (const r of rows) {
    const k = keyOf(r.date);
    const b = map.get(k) || { key: k, frgn: 0, orgn: 0, prsn: 0 };
    b.frgn += r.frgnQty || 0;
    b.orgn += r.orgnQty || 0;
    b.prsn += r.prsnQty || 0;
    map.set(k, b);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

// YYYYMMDD
function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// ---- KRX 정보데이터시스템 과거 백필 (비공식, MDCSTAT02302 일별추이) ----
//  순매수 수량(주). 컬럼: TRDVAL1=기관합계 · TRDVAL2=기타법인 · TRDVAL3=개인 · TRDVAL4=외국인
const ISIN: Record<string, string> = {
  "005930": "KR7005930003", // 삼성전자
  "000660": "KR7000660001", // SK하이닉스
};
const krxMem: Record<string, { at: number; data: Day[] }> = {};

async function fetchKRX(code: string): Promise<Day[]> {
  const isu = ISIN[code];
  if (!isu) return [];
  const c = krxMem[code];
  if (c && Date.now() - c.at < 6 * 3600 * 1000) return c.data; // 6시간 메모리 캐시

  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 4);
  const body = new URLSearchParams({
    bld: "dbms/MDC/STAT/standard/MDCSTAT02302",
    locale: "ko_KR",
    isuCd: isu,
    strtDd: ymd(start),
    endDd: ymd(end),
    inqTpCd: "2",   // 일별추이
    trdVolVal: "1", // 1=거래량(주)
    askBid: "3",    // 3=순매수
    csvxls_isNo: "false",
  });
  const res = await fetch("https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": "Mozilla/5.0",
      referer: "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020302",
    },
    body: body.toString(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KRX ${res.status}`);
  const data: any = await res.json();
  const rows: any[] = data.output || data.OutBlock_1 || [];
  const p = (v: any) => {
    const n = parseInt(String(v ?? "0").replace(/[,\s]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  };
  const out: Day[] = rows
    .map((r) => ({
      date: String(r.TRD_DD || "").replace(/[/\-.]/g, ""),
      orgnQty: p(r.TRDVAL1), prsnQty: p(r.TRDVAL3), frgnQty: p(r.TRDVAL4),
      frgnAmt: 0, orgnAmt: 0, prsnAmt: 0,
    }))
    .filter((d) => d.date.length === 8);
  krxMem[code] = { at: Date.now(), data: out };
  return out;
}

async function fetchInvestor(code: string) {
  const data = await kisGet(
    "/uapi/domestic-stock/v1/quotations/inquire-investor",
    "FHKST01010900",
    { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code }
  );
  const rows: any[] = Array.isArray(data.output) ? data.output : data.output1 || data.output2 || [];
  const fresh: Day[] = rows
    .filter((r) => r && r.stck_bsop_date)
    .map((r) => ({
      date: String(r.stck_bsop_date),
      frgnQty: num(r.frgn_ntby_qty), orgnQty: num(r.orgn_ntby_qty), prsnQty: num(r.prsn_ntby_qty),
      frgnAmt: num(r.frgn_ntby_tr_pbmn), orgnAmt: num(r.orgn_ntby_tr_pbmn), prsnAmt: num(r.prsn_ntby_tr_pbmn),
    }));

  // 저장소 버퍼에 날짜 기준으로 누적(중복 제거)
  const BKEY = `invbuf:${code}`;
  const stored = (await storeGet<Day[]>(BKEY)) || [];
  const map = new Map<string, Day>();
  for (const b of stored) if (b && b.date) map.set(b.date, b);
  // 저장된 과거가 얕으면(누적 부족) KRX로 한 번 백필
  if (stored.length < 200) {
    try {
      const krx = await fetchKRX(code);
      for (const b of krx) if (!map.has(b.date)) map.set(b.date, b);
    } catch {
      /* KRX 실패 → KIS 누적으로 폴백 */
    }
  }
  for (const b of fresh) map.set(b.date, b); // KIS 최신값 우선
  let all = [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (all.length > 1600) all = all.slice(-1600); // ~6년치 보관
  await storeSet(BKEY, all, BUF_TTL);

  // 주/월/년 누적 순매수(수량) — 최근 4개씩
  const week = aggregate(all, mondayKey).slice(-4).map((b) => ({ label: `${+b.key.slice(4, 6)}.${+b.key.slice(6, 8)}`, frgn: b.frgn, orgn: b.orgn, prsn: b.prsn }));
  const month = aggregate(all, (d) => d.slice(0, 6)).slice(-4).map((b) => ({ label: `${+b.key.slice(4, 6)}월`, frgn: b.frgn, orgn: b.orgn, prsn: b.prsn }));
  const year = aggregate(all, (d) => d.slice(0, 4)).slice(-4).map((b) => ({ label: b.key, frgn: b.frgn, orgn: b.orgn, prsn: b.prsn }));

  return { code, items: fresh.slice(0, 20), periods: { week, month, year } };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const code = sp.get("code") || "005930";
  const force = sp.get("force") === "1";

  // KRX 백필 확인용: /api/investor?code=005930&debug=krx
  if (sp.get("debug") === "krx") {
    try {
      const krx = await fetchKRX(code);
      return NextResponse.json({ count: krx.length, first: krx[0] ?? null, last: krx[krx.length - 1] ?? null });
    } catch (e: any) {
      return NextResponse.json({ error: e.message });
    }
  }

  // 원본 필드/단위 확인용: /api/investor?code=005930&debug=1
  if (sp.get("debug") === "1") {
    try {
      const raw = await kisGet(
        "/uapi/domestic-stock/v1/quotations/inquire-investor",
        "FHKST01010900",
        { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code }
      );
      const rows = Array.isArray(raw.output) ? raw.output : raw.output1 || raw.output2 || [];
      return NextResponse.json({ sample: rows[0] ?? null, count: rows.length });
    } catch (e: any) {
      return NextResponse.json({ error: e.message });
    }
  }

  const key = `invres:${code}`;
  if (!force) {
    const cached = await storeGet(key);
    if (cached) return NextResponse.json(cached);
  }
  try {
    const result = await fetchInvestor(code);
    await storeSet(key, result, TTL);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ code, items: [], periods: { week: [], month: [], year: [] }, error: e.message });
  }
}
