import { NextResponse } from "next/server";
import { storeGet, storeSet } from "@/lib/store";

// 무료 뉴스: 구글 뉴스 RSS (앱키 불필요) — 저장소 캐시(5분, 화면도 5분마다 폴링). ?force=1 새로 받음.
const TTL = 300; // 5분

async function fetchNews(q: string) {
  const rss = `https://news.google.com/rss/search?q=${encodeURIComponent(
    q
  )}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(rss, {
    headers: { "user-agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`뉴스 조회 실패 (${res.status})`);
  const xml = await res.text();

  const pick = (block: string, tag: string): string => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    if (!m) return "";
    return m[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();
  };

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .slice(0, 30)
    .map((m) => {
      const block = m[1];
      return {
        title: pick(block, "title"),
        source: pick(block, "source"),
        link: pick(block, "link"),
        pubDate: pick(block, "pubDate"),
      };
    })
    .filter((it) => it.title);

  return { q, items };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q") || "삼성전자";
  const force = sp.get("force") === "1";

  const key = `news:${q}`;
  if (!force) {
    const cached = await storeGet(key);
    if (cached) return NextResponse.json(cached);
  }

  try {
    const result = await fetchNews(q);
    await storeSet(key, result, TTL);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "뉴스 조회 실패" }, { status: 500 });
  }
}
