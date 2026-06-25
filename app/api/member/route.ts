import { NextResponse } from "next/server";
import { kisGet, num } from "@/lib/kis";
import { storeGet, storeSet } from "@/lib/store";

// 거래원(회원사): 매수/매도 상위 5개 증권사 + 거래량. KIS inquire-member (FHKST01010600).
// 당일 누적 스냅샷(장중 갱신). 저장소 캐시 15초. ?debug=1 원본 확인.
export const dynamic = "force-dynamic";
const TTL = 15;

// 외국계 거래원 이름 패턴(글로벌 플래그가 없을 때 폴백 판별용)
const FOREIGN_RE =
  /유비에스|UBS|모[간건]스탠리|모간|모건|Morgan|메릴|Merrill|골드만|Goldman|제이피|JP|노무라|Nomura|크레디|Credit|CLSA|씨엘에스|맥쿼리|Macquarie|다이와|Daiwa|도이치|Deutsche|비엔피|BNP|미즈호|Mizuho|HSBC|에이치에스비|씨티그룹|Citi|글로벌마켓|시지에스|CGS/i;

function side(o: any, prefix: "seln" | "shnu") {
  const arr: { name: string; qty: number; foreign: boolean }[] = [];
  for (let i = 1; i <= 5; i++) {
    const name = String(o[`${prefix}_mbcr_name${i}`] || "").trim();
    if (!name) continue;
    const qty = num(o[`total_${prefix}_qty${i}`]);
    const glob = String(o[`${prefix}_mbcr_glob_yn_${i}`] ?? o[`${prefix}_mbcr_glob_yn${i}`] ?? "");
    arr.push({ name, qty, foreign: glob === "Y" || FOREIGN_RE.test(name) });
  }
  return arr;
}

async function fetchMember(code: string) {
  const data = await kisGet(
    "/uapi/domestic-stock/v1/quotations/inquire-member",
    "FHKST01010600",
    { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code }
  );
  const o: any = data.output || {};
  return { code, buy: side(o, "shnu"), sell: side(o, "seln") };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const code = sp.get("code") || "005930";
  const force = sp.get("force") === "1";

  if (sp.get("debug") === "1") {
    try {
      const raw = await kisGet(
        "/uapi/domestic-stock/v1/quotations/inquire-member",
        "FHKST01010600",
        { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code }
      );
      return NextResponse.json({ output: raw.output ?? null });
    } catch (e: any) {
      return NextResponse.json({ error: e.message });
    }
  }

  const key = `member:${code}`;
  if (!force) {
    const cached = await storeGet(key);
    if (cached) return NextResponse.json(cached);
  }
  try {
    const result = await fetchMember(code);
    await storeSet(key, result, TTL);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ code, buy: [], sell: [], error: e.message });
  }
}
