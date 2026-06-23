import { NextResponse } from "next/server";
import { STOCKS } from "@/lib/kis";

// 크론: 저장소를 미리 채운다(차트 1일~1년·재무·뉴스). 각 라우트를 force=1로 호출 → 새로 받아 저장.
// 1일(분봉)도 호출해 '그날 세션'을 분봉 버퍼에 스냅샷으로 쌓는다(다음 날 누적 12시간용).
//  → 장 마감 후(20:00 KST 부근)에 도는 크론이면 그날 전체 세션이 통째로 저장된다.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function baseUrl(req: Request): string {
  const env =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (env) return env.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function GET(req: Request) {
  // 보안: CRON_SECRET이 설정돼 있으면 검증 (Vercel Cron은 Authorization: Bearer <CRON_SECRET> 전송)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const base = baseUrl(req);
  const codes = Object.keys(STOCKS);
  const ranges = ["1D", "1W", "1M", "3M", "1Y"]; // 1D = 분봉 버퍼에 당일 세션 스냅샷(누적용)
  const results: string[] = [];

  const hit = async (label: string, url: string) => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      results.push(`${label}: ${r.status}`);
    } catch (e: any) {
      results.push(`${label}: ERR ${e.message}`);
    }
  };

  for (const code of codes) {
    for (const range of ranges) {
      await hit(`chart ${code} ${range}`, `${base}/api/chart?code=${code}&range=${range}&force=1`);
    }
    await hit(`fin ${code}`, `${base}/api/financials?code=${code}&force=1`);
    await hit(`daily ${code}`, `${base}/api/daily?code=${code}&force=1`);
    await hit(`consensus ${code}`, `${base}/api/consensus?code=${code}&force=1`);
    await hit(`disc ${code}`, `${base}/api/disclosure?code=${code}&force=1`);
    await hit(`investor ${code}`, `${base}/api/investor?code=${code}&force=1`);
  }
  for (const code of codes) {
    const q = STOCKS[code].name;
    await hit(`news ${q}`, `${base}/api/news?q=${encodeURIComponent(q)}&force=1`);
  }

  return NextResponse.json({ ok: true, count: results.length, results });
}
