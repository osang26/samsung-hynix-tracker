// 저장소(Upstash Redis) — 차트·재무·뉴스 같은 '자주 안 변하는' 데이터를 받아 저장해두고,
// 페이지는 여기서만 읽는다. (현재가는 저장 안 하고 KIS 직접 = 실시간)
//
// 환경변수(UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)가 없으면
// 저장소를 쓰지 않고 그냥 직접 호출로 동작한다(로컬에서 Upstash 없이도 작동).

import { Redis } from "@upstash/redis";

let client: Redis | null = null;
let checked = false;

function getRedis(): Redis | null {
  if (checked) return client;
  checked = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) client = new Redis({ url, token });
  return client;
}

export async function storeGet<T = any>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return (await r.get<T>(key)) ?? null;
  } catch {
    return null;
  }
}

export async function storeSet(key: string, value: any, ttlSec: number): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, value, { ex: ttlSec });
  } catch {
    /* 저장 실패해도 화면은 계속 동작 */
  }
}

export async function storeDel(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(key);
  } catch {
    /* 삭제 실패해도 무시 */
  }
}

export function storeEnabled(): boolean {
  return !!getRedis();
}
