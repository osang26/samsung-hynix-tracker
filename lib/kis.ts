// KIS Open API 공용 헬퍼 (토큰 발급/캐시 + GET 호출)
// 앱키/시크릿은 .env.local 에서 읽습니다. (코드에 직접 적지 않기!)

const BASE = process.env.KIS_BASE || "https://openapi.koreainvestment.com:9443";
const APP_KEY = process.env.KIS_APP_KEY || "";
const APP_SECRET = process.env.KIS_APP_SECRET || "";

// 우리가 다루는 종목
export const STOCKS: Record<string, { name: string }> = {
  "005930": { name: "삼성전자" },
  "000660": { name: "SK하이닉스" },
};

// 접근토큰은 24시간 유효 → 메모리에 캐시해서 재사용 (KIS 권장)
// KIS는 토큰 발급을 "1분당 1회"로 제한하므로, 여러 요청이 동시에 와도
// 발급은 딱 한 번만 하고 모두가 그 결과를 같이 기다리게 한다(single-flight).
let cachedToken: { token: string; expires: number } | null = null;
let inflight: Promise<string> | null = null;

async function issueToken(): Promise<string> {
  if (!APP_KEY || !APP_SECRET) {
    throw new Error(".env.local 에 KIS_APP_KEY / KIS_APP_SECRET 를 설정하세요.");
  }
  const res = await fetch(`${BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: APP_KEY,
      appsecret: APP_SECRET,
    }),
    cache: "no-store",
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(
      `KIS 토큰 발급 실패 (${res.status}). ${data.error_description || data.msg1 || "앱키를 확인하세요."}`
    );
  }
  cachedToken = {
    token: data.access_token,
    expires: Date.now() + 23 * 60 * 60 * 1000, // 만료(24h) 약간 전에 갱신
  };
  return data.access_token;
}

export async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.token;
  // 이미 발급 요청이 진행 중이면 새로 발급하지 않고 그 요청을 함께 기다린다.
  if (!inflight) {
    inflight = issueToken().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

// KIS 초당 호출 제한(EGW00201) 방지 — 모든 호출을 최소 간격 이상으로 띄운다(전역).
let nextSlot = 0;
async function throttle(gapMs: number): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + gapMs;
  const wait = start - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

// KIS GET 호출 (tr_id 별)
export async function kisGet(
  path: string,
  trId: string,
  params: Record<string, string>,
  revalidateSec?: number // 주면 그 초만큼 서버 캐시(자주 안 변하는 데이터용). 없으면 항상 최신.
): Promise<any> {
  const token = await getToken();
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const cacheOpt =
    typeof revalidateSec === "number"
      ? { next: { revalidate: revalidateSec } }
      : { cache: "no-store" as const };

  await throttle(70); // 초당 호출 제한(EGW00201) 방지

  const res = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: APP_KEY,
      appsecret: APP_SECRET,
      tr_id: trId,
      custtype: "P",
    },
    ...cacheOpt,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`KIS 호출 실패 (${trId}, ${res.status}). ${t.slice(0, 120)}`);
  }
  return res.json();
}

// 숫자 안전 변환
export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
