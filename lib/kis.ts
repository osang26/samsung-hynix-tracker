// KIS Open API 공용 헬퍼 (토큰 발급/캐시 + GET 호출)
// 앱키/시크릿은 .env.local 에서 읽습니다. (코드에 직접 적지 않기!)
import { storeGet, storeSet } from "./store";

const BASE = process.env.KIS_BASE || "https://openapi.koreainvestment.com:9443";
const APP_KEY = process.env.KIS_APP_KEY || "";
const APP_SECRET = process.env.KIS_APP_SECRET || "";

// 우리가 다루는 종목
export const STOCKS: Record<string, { name: string; corp?: string }> = {
  "005930": { name: "삼성전자", corp: "00126380" },   // corp = DART 고유번호(공시용)
  "000660": { name: "SK하이닉스", corp: "00164779" },
};

// 접근토큰은 24시간 유효 → 재사용. 서버리스(Vercel)에선 요청마다 인스턴스가 따로라
// 각자 발급하면 "1분당 1회" 제한(EGW00133)에 걸린다. → 공유 저장소(Redis)에 토큰을
// 저장해 모든 인스턴스가 같은 토큰을 재사용한다. (저장소 없으면 메모리만 사용)
const TOKEN_KEY = "kis:token";
let cachedToken: { token: string; expires: number } | null = null;
let inflight: Promise<string> | null = null;
const _sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const token: string = data.access_token;
  cachedToken = { token, expires: Date.now() + 23 * 60 * 60 * 1000 };
  await storeSet(TOKEN_KEY, token, 23 * 60 * 60); // 공유 저장소에도 저장(인스턴스 간 재사용)
  return token;
}

// 발급 실패(동시 발급 경쟁 등) 시, 다른 인스턴스가 막 저장했을 수 있으니 잠깐 뒤 저장소 재확인
async function issueOrReuse(): Promise<string> {
  try {
    return await issueToken();
  } catch (e) {
    await _sleep(1500);
    const again = await storeGet<string>(TOKEN_KEY);
    if (again) {
      cachedToken = { token: again, expires: Date.now() + 60 * 60 * 1000 };
      return again;
    }
    throw e;
  }
}

export async function getToken(): Promise<string> {
  // 1) 메모리 캐시
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.token;
  // 2) 공유 저장소(Redis) — 서버리스 인스턴스 간 토큰 공유
  const stored = await storeGet<string>(TOKEN_KEY);
  if (stored) {
    cachedToken = { token: stored, expires: Date.now() + 60 * 60 * 1000 };
    return stored;
  }
  // 3) 없으면 발급(같은 인스턴스 내 동시 발급 방지)
  if (!inflight) {
    inflight = issueOrReuse().finally(() => {
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
