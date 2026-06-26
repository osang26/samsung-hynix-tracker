"use client";

import { useEffect, useState } from "react";

// 컴팩트 실시간 위젯 — 5초마다 현재가·등락 갱신. 작은 창(팝업)으로 띄우기 좋게.
const STOCKS = [
  { code: "005930", name: "삼성전자" },
  { code: "000660", name: "SK하이닉스" },
];

function won(n: any): string {
  return Number(n || 0).toLocaleString("ko-KR");
}
function eok(n: any): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1) + "조";
  return Math.round(v).toLocaleString("ko-KR") + "억";
}
function session(): string {
  const d = new Date();
  const m = d.getHours() * 60 + d.getMinutes();
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return "주말 휴장";
  if (m >= 480 && m < 540) return "프리마켓";
  if (m >= 540 && m < 930) return "정규장";
  if (m >= 930 && m < 1200) return "애프터마켓";
  return "장마감";
}

export default function Widget() {
  const [idx, setIdx] = useState(0);
  const [quote, setQuote] = useState<any>(null);
  const [now, setNow] = useState("");
  const stock = STOCKS[idx];

  // 현재가 5초마다
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/quote?code=${stock.code}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => { if (alive) setQuote(d); })
        .catch(() => {});
    setQuote(null);
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [stock.code]);

  // 시계(1초)
  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toLocaleTimeString("ko-KR")), 1000);
    return () => clearInterval(id);
  }, []);

  const up = quote && quote.dir === "up";
  const down = quote && quote.dir === "down";
  const col = up ? "#e5453b" : down ? "#2f6bdb" : "#98a2b3";
  const bg = up ? "rgba(229,69,59,.10)" : down ? "rgba(47,107,219,.10)" : "rgba(152,162,179,.12)";

  return (
    <div className="wbox">
      <div className="wtoggle">
        {STOCKS.map((s, i) => (
          <button key={s.code} className={"wtab" + (i === idx ? " on" : "")} onClick={() => setIdx(i)}>
            {s.name}
          </button>
        ))}
      </div>
      <div className="wmkt">KRX · KOSPI</div>
      <div className="wname">{stock.name} <span className="wcode">{stock.code}</span></div>

      {quote && !quote.error ? (
        <>
          <div className="wprice">₩{won(quote.price)}</div>
          <div className="wchg" style={{ color: col, background: bg }}>
            {up ? "▲" : down ? "▼" : "—"} {Number(quote.change).toLocaleString("ko-KR")} ({quote.changeRate}%)
          </div>
          <div className="wsub">시총 {eok(quote.marketCap)} · 거래량 {Number(quote.volume).toLocaleString("ko-KR")}</div>
          <div className="wstatus"><span className="wdot" /> {session()} · 실시간 · {now}</div>
        </>
      ) : (
        <div className="wskel">{quote && quote.error ? "현재가 오류" : "불러오는 중…"}</div>
      )}

      <a className="wlink" href="/">전체 사이트로 이동 →</a>
    </div>
  );
}
