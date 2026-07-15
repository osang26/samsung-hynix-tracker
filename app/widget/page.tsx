"use client";

import { useEffect, useState } from "react";

// 컴팩트 실시간 위젯 — 삼성전자 · SK하이닉스 · SKHY ADR. 5초마다 갱신.
const TABS = [
  { key: "005930", name: "삼성전자", kind: "kr" as const },
  { key: "000660", name: "SK하이닉스", kind: "kr" as const },
  { key: "adr", name: "SKHY ADR", kind: "adr" as const },
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
function krSession(): string {
  const d = new Date();
  const m = d.getHours() * 60 + d.getMinutes();
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return "주말 휴장";
  if (m >= 480 && m < 540) return "프리마켓";
  if (m >= 540 && m < 930) return "정규장";
  if (m >= 930 && m < 1200) return "애프터마켓";
  return "장마감";
}
const US_SESSION: Record<string, string> = {
  regular: "정규장", premarket: "프리마켓", afterhours: "애프터마켓", daymarket: "데이마켓", closed: "장마감",
};

export default function Widget() {
  const [idx, setIdx] = useState(0);
  const [quote, setQuote] = useState<any>(null); // 국내(삼성/하이닉스)
  const [adr, setAdr] = useState<any>(null);     // SKHY 실시간가
  const [fx, setFx] = useState<any>(null);       // 원/달러
  const [hynix, setHynix] = useState<any>(null); // 본주(괴리율 계산용)
  const [now, setNow] = useState("");
  const tab = TABS[idx];
  const isAdr = tab.kind === "adr";

  // 국내 현재가 5초 (삼성/하이닉스)
  useEffect(() => {
    if (isAdr) return;
    let alive = true;
    const load = () =>
      fetch(`/api/quote?code=${tab.key}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => { if (alive) setQuote(d); })
        .catch(() => {});
    setQuote(null);
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [tab.key, isAdr]);

  // ADR 탭: SKHY 5초 + 본주 5초 + 환율 10분
  useEffect(() => {
    if (!isAdr) return;
    let alive = true;
    const loadAdr = () => fetch(`/api/adr`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (alive) setAdr(d); }).catch(() => {});
    const loadHynix = () => fetch(`/api/quote?code=000660`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (alive) setHynix(d); }).catch(() => {});
    const loadFx = () => fetch(`/api/fx`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (alive) setFx(d); }).catch(() => {});
    setAdr(null);
    loadAdr(); loadHynix(); loadFx();
    const a = setInterval(loadAdr, 5000);
    const h = setInterval(loadHynix, 5000);
    const f = setInterval(loadFx, 600000);
    return () => { alive = false; clearInterval(a); clearInterval(h); clearInterval(f); };
  }, [isAdr]);

  // 시계(1초)
  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toLocaleTimeString("ko-KR")), 1000);
    return () => clearInterval(id);
  }, []);

  // ---- 국내 카드 색상(한국식: 상승 빨강 / 하락 파랑) ----
  const up = quote && quote.dir === "up";
  const down = quote && quote.dir === "down";
  const col = up ? "#e5453b" : down ? "#2f6bdb" : "#98a2b3";
  const bg = up ? "rgba(229,69,59,.10)" : down ? "rgba(47,107,219,.10)" : "rgba(152,162,179,.12)";

  // ---- ADR 계산 ----
  const adrPrice = adr && adr.price ? Number(adr.price) : null;
  const adrRate = adr && typeof adr.changeRate === "number" ? adr.changeRate : null;
  const hynixPrice = hynix && hynix.price ? Number(hynix.price) : null;
  const fxRate = fx && fx.rate ? Number(fx.rate) : null;
  // 괴리율(비율) = ADR가 × 환율 × 10 ÷ 본주가 (100% = 적정) → 편차 dev
  const parity = adrPrice && fxRate && hynixPrice ? ((adrPrice * fxRate * 10) / hynixPrice) * 100 : null;
  const dev = parity != null ? parity - 100 : null;
  const aUp = adrRate != null && adrRate > 0;
  const aDown = adrRate != null && adrRate < 0;
  const aCol = aUp ? "#e5453b" : aDown ? "#2f6bdb" : "#98a2b3";
  const aBg = aUp ? "rgba(229,69,59,.10)" : aDown ? "rgba(47,107,219,.10)" : "rgba(152,162,179,.12)";
  const devCol = dev == null ? "#98a2b3" : dev > 0.1 ? "#e5453b" : dev < -0.1 ? "#2f6bdb" : "#98a2b3";

  return (
    <div className="wbox">
      <div className="wtoggle">
        {TABS.map((t, i) => (
          <button key={t.key} className={"wtab" + (i === idx ? " on" : "")} onClick={() => setIdx(i)}>
            {t.name}
          </button>
        ))}
      </div>

      {!isAdr ? (
        <>
          <div className="wmkt">KRX · KOSPI</div>
          <div className="wname">{tab.name} <span className="wcode">{tab.key}</span></div>
          {quote && !quote.error ? (
            <>
              <div className="wprice">₩{won(quote.price)}</div>
              <div className="wchg" style={{ color: col, background: bg }}>
                {up ? "▲" : down ? "▼" : "—"} {Number(quote.change).toLocaleString("ko-KR")} ({quote.changeRate}%)
              </div>
              <div className="wsub">시총 {eok(quote.marketCap)} · 거래량 {Number(quote.volume).toLocaleString("ko-KR")}</div>
              <div className="wstatus"><span className="wdot" /> {krSession()} · 실시간 · {now}</div>
            </>
          ) : (
            <div className="wskel">{quote && quote.error ? "현재가 오류" : "불러오는 중…"}</div>
          )}
        </>
      ) : (
        <>
          <div className="wmkt">NASDAQ · ADR</div>
          <div className="wname">SKHY ADR <span className="wcode">SKHY</span></div>
          {adrPrice != null ? (
            <>
              <div className="wprice">${adrPrice.toFixed(2)}</div>
              <div className="wchg" style={{ color: aCol, background: aBg }}>
                {aUp ? "▲" : aDown ? "▼" : "—"} {adr && typeof adr.change === "number" ? adr.change.toFixed(2) : "-"} ({adrRate != null ? adrRate : "-"}%)
              </div>
              <div className="wsub">
                본주 대비 괴리율 <b style={{ color: devCol }}>{dev == null ? "—" : (dev > 0 ? "+" : "") + dev.toFixed(2) + "%"}</b>
                {dev != null ? (dev > 0 ? " (프리미엄)" : dev < 0 ? " (디스카운트)" : "") : ""}
              </div>
              <div className="wstatus"><span className="wdot" /> {adr ? (US_SESSION[adr.session] || adr.session) : "…"} · 실시간 · {now}</div>
            </>
          ) : (
            <div className="wskel">{adr && adr.available === false ? "미국 장 시간 아님 · 시세 대기" : "불러오는 중…"}</div>
          )}
        </>
      )}

      <a className="wlink" href="/">전체 사이트로 이동 →</a>
    </div>
  );
}
