import { NextResponse } from "next/server";
import { STOCKS } from "@/lib/kis";
import { storeGet, storeSet } from "@/lib/store";

// 공시: DART(전자공시) Open API list.json 으로 최근 공시 목록을 가져온다.
// DART_API_KEY(무료, opendart.fss.or.kr)가 없으면 빈 목록으로 graceful 처리.
export const dynamic = "force-dynamic";
const TTL = 3600; // 1시간
const KEY = process.env.DART_API_KEY || "";

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

async function fetchDisclosure(code: string) {
  const corp = STOCKS[code]?.corp;
  if (!KEY || !corp) return { code, items: [], enabled: !!KEY };

  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 3); // 최근 3개월

  const url =
    `https://opendart.fss.or.kr/api/list.json?crtfc_key=${KEY}` +
    `&corp_code=${corp}&bgn_de=${yyyymmdd(start)}&end_de=${yyyymmdd(end)}` +
    `&page_no=1&page_count=12`;

  const res = await fetch(url, { cache: "no-store" });
  const data: any = await res.json().catch(() => ({}));
  const list: any[] = Array.isArray(data.list) ? data.list : [];

  const items = list
    .map((r) => ({
      title: String(r.report_nm || "").trim(),
      date: String(r.rcept_dt || ""), // 원본 YYYYMMDD → 화면에서 한국식으로 포맷
      filer: String(r.flr_nm || "").trim(),
      url: r.rcept_no
        ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r.rcept_no}`
        : "https://dart.fss.or.kr",
    }))
    .filter((it) => it.title);

  return { code, items, enabled: true };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const code = sp.get("code") || "005930";
  const force = sp.get("force") === "1";

  const key = `disc:${code}`;
  if (!force) {
    const cached = await storeGet(key);
    if (cached) return NextResponse.json(cached);
  }
  try {
    const result = await fetchDisclosure(code);
    await storeSet(key, result, TTL);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ code, items: [], error: e.message });
  }
}
