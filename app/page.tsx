"use client";

import { useEffect, useState, useCallback } from "react";
import {
  LineChart,
  BarChart,
  Line,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

const STOCKS = [
  { code: "005930", name: "삼성전자", color: "#4f8cff" },
  { code: "000660", name: "SK하이닉스", color: "#f5a623" },
];

// ✏️ PER 계산용 — 분기별 당기순이익(억원)을 직접 입력하세요.
//   · 최근 4개 분기를 넣으면 그 합(최근 1년)으로 PER를 계산합니다.  PER = 시가총액 ÷ 최근4분기 순이익 합
//   · 비워두면 [] → KIS 연간 순이익으로 자동 계산합니다.
//   예) "005930": [95000, 110000, 130000, 137000]   // 단위: 억원
const QUARTERLY_NET_INCOME: Record<string, number[]> = {
  "005930": [],
  "000660": [],
};

// ---- 표시 형식 헬퍼 ----
function won(n: any): string {
  return Number(n || 0).toLocaleString("ko-KR") + "원";
}
function eok(n: any): string {
  if (n === null || n === undefined || n === "") return "-";
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1) + "조원";
  return Math.round(v).toLocaleString("ko-KR") + "억원";
}
function dirClass(dir: string): string {
  return dir === "up" ? "up" : dir === "down" ? "down" : "flat";
}
function arrow(dir: string): string {
  return dir === "up" ? "▲" : dir === "down" ? "▼" : "–";
}
function fmtDate(d: string): string {
  if (!d || d.length < 8) return d || "";
  return d.slice(2, 4) + "." + d.slice(4, 6) + "." + d.slice(6, 8);
}
function fmtPeriod(p: string): string {
  if (!p || p.length < 6) return p || "";
  return p.slice(0, 4) + "년 " + p.slice(4, 6) + "월 기준";
}
function fmtQ(p: string): string {
  if (!p || p.length < 6) return p || "";
  const y = p.slice(0, 4);
  const q: Record<string, string> = { "03": "1", "06": "2", "09": "3", "12": "4" };
  return y + " " + (q[p.slice(4, 6)] || "?") + "분기";
}
function compactVol(v: any): string {
  const n = Number(v) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(0) + "억";
  if (n >= 1e4) return Math.round(n / 1e4) + "만";
  return String(n);
}

function StockCard({ code, name, color }: { code: string; name: string; color: string }) {
  const [quote, setQuote] = useState<any>(null);
  const [qErr, setQErr] = useState("");
  const [chart, setChart] = useState<any>(null);
  const [fin, setFin] = useState<any>(null);
  const [news, setNews] = useState<any>(null);
  const [tab, setTab] = useState("chart"); // chart | news | fin
  const [range, setRange] = useState("1D"); // 1D 1W 1M 3M 1Y (기본: 1일)

  const loadQuote = useCallback(async () => {
    try {
      const r = await fetch(`/api/quote?code=${code}`);
      const d = await r.json();
      if (d.error) setQErr(d.error);
      else {
        setQuote(d);
        setQErr("");
      }
    } catch {
      setQErr("네트워크 오류");
    }
  }, [code]);

  // 현재가: 즉시 + 30초마다
  useEffect(() => {
    loadQuote();
    const id = setInterval(loadQuote, 30000);
    return () => clearInterval(id);
  }, [loadQuote]);

  // 재무 / 뉴스: 1회
  useEffect(() => {
    fetch(`/api/financials?code=${code}`).then((r) => r.json()).then(setFin).catch(() => setFin({ error: "재무 오류" }));
    fetch(`/api/news?q=${encodeURIComponent(name)}`).then((r) => r.json()).then(setNews).catch(() => setNews({ error: "뉴스 오류" }));
  }, [code, name]);

  // 차트: 기간(range)이 바뀔 때마다 다시 받아옴
  useEffect(() => {
    setChart(null);
    fetch(`/api/chart?code=${code}&range=${range}`).then((r) => r.json()).then(setChart).catch(() => setChart({ error: "차트 오류" }));
  }, [code, range]);

  // PER = 시가총액 ÷ 순이익 (직접 계산). 분기 입력값이 있으면 최근 4분기 합, 없으면 KIS 연간 순이익.
  const manualQ = QUARTERLY_NET_INCOME[code] || [];
  const ttmNet =
    manualQ.length > 0
      ? manualQ.slice(-4).reduce((a, b) => a + b, 0)
      : fin && typeof fin.ttmNet === "number"
      ? fin.ttmNet
      : fin && typeof fin.netIncome === "number"
      ? fin.netIncome
      : null;
  const perCalc =
    quote && quote.marketCap && ttmNet && ttmNet > 0 ? quote.marketCap / ttmNet : null;
  const perText = perCalc != null ? perCalc.toFixed(1) + "배" : fin === null ? "…" : "-";

  return (
    <div className="card">
      <div className="top">
        <div>
          <span className="name">{name}</span>
          <span className="code">{code}</span>
        </div>
      </div>

      {qErr && <div className="err">{qErr}</div>}
      {!quote && !qErr && <div className="skeleton">현재가 불러오는 중…</div>}
      {quote && (
        <>
          <div className="price">{won(quote.price)}</div>
          <div className={"change " + dirClass(quote.dir)}>
            {arrow(quote.dir)} {Number(quote.change).toLocaleString("ko-KR")}원 ({quote.changeRate}%)
          </div>
          <div className="stats">
            <div className="stat"><div className="k">시가총액</div><div className="v">{eok(quote.marketCap)}</div></div>
            <div className="stat"><div className="k">PER</div><div className="v">{perText}</div></div>
            <div className="stat"><div className="k">거래량</div><div className="v">{Number(quote.volume).toLocaleString("ko-KR")}</div></div>
            <div className="stat"><div className="k">52주 高/低</div><div className="v" style={{ fontSize: 12 }}>{Number(quote.high52).toLocaleString("ko-KR")}/{Number(quote.low52).toLocaleString("ko-KR")}</div></div>
          </div>
        </>
      )}

      <div className="tabs">
        <button className={"tab-btn" + (tab === "chart" ? " active" : "")} onClick={() => setTab("chart")}>차트</button>
        <button className={"tab-btn" + (tab === "news" ? " active" : "")} onClick={() => setTab("news")}>뉴스</button>
        <button className={"tab-btn" + (tab === "fin" ? " active" : "")} onClick={() => setTab("fin")}>재무</button>
      </div>

      <div className="tab-panel">
        {tab === "chart" && (
          <>
            <div className="ranges">
              {([["1D", "1일"], ["1W", "1주"], ["1M", "1달"], ["3M", "3달"], ["1Y", "1년"]] as [string, string][]).map(
                ([r, label]) => (
                  <button
                    key={r}
                    className={"range-btn" + (range === r ? " active" : "")}
                    onClick={() => setRange(r)}
                  >
                    {label}
                  </button>
                )
              )}
            </div>
            {chart && chart.series && chart.series.length > 0 ? (
              <div className="chartwrap">
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={chart.series} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
                    <XAxis dataKey="label" hide />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "#7e8ca6" }} width={50} tickFormatter={(v: any) => Number(v).toLocaleString("ko-KR")} />
                    <Tooltip formatter={(v: any) => won(v)} contentStyle={{ background: "#0f1a2e", border: "1px solid #25344f", borderRadius: 8, fontSize: 12, color: "#eaf0fb" }} />
                    <Line type="monotone" dataKey="close" name="가격" stroke={color} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="vol-cap">거래량</div>
                <ResponsiveContainer width="100%" height={58}>
                  <BarChart data={chart.series} margin={{ top: 0, right: 8, left: 8, bottom: 0 }} barCategoryGap={0}>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#7e8ca6" }} minTickGap={36} />
                    <YAxis width={50} tick={{ fontSize: 9, fill: "#7e8ca6" }} tickFormatter={(v: any) => compactVol(v)} />
                    <Tooltip formatter={(v: any) => Number(v).toLocaleString("ko-KR") + "주"} contentStyle={{ background: "#0f1a2e", border: "1px solid #25344f", borderRadius: 8, fontSize: 12, color: "#eaf0fb" }} />
                    <Bar dataKey="volume" name="거래량" fill="#5b7bb5" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : chart && chart.error ? (
              <div className="err">{chart.error}</div>
            ) : (
              <div className="skeleton" style={{ padding: "70px 0", textAlign: "center" }}>차트 불러오는 중…</div>
            )}
            {chart && chart.candle && chart.series && chart.series.length > 0 && (
              <div className="fin-note">{chart.candle} 기준 · {chart.series.length}개</div>
            )}
          </>
        )}

        {tab === "news" &&
          (news && news.items && news.items.length > 0 ? (
            <ul className="news">
              {news.items.map((it: any, i: number) => (
                <li key={i}>
                  <a href={it.link} target="_blank" rel="noreferrer">{it.title}</a>
                  <div className="date">{it.source ? it.source + " · " : ""}{it.pubDate}</div>
                </li>
              ))}
            </ul>
          ) : news && news.error ? (
            <div className="err">{news.error}</div>
          ) : (
            <div className="skeleton">뉴스 불러오는 중…</div>
          ))}

        {tab === "fin" &&
          (fin && !fin.error ? (
            <>
              <div className="fin">
                <div className="item"><div className="k">매출액</div><div className="v">{eok(fin.revenue)}</div></div>
                <div className="item"><div className="k">영업이익</div><div className="v">{eok(fin.operatingProfit)}</div></div>
                <div className="item"><div className="k">순이익</div><div className="v">{eok(fin.netIncome)}</div></div>
              </div>
              {fin.period && <div className="fin-note">연간 기준: {fmtPeriod(fin.period)}</div>}

              {fin.quarters && fin.quarters.length > 0 && (
                <div className="qbreak">
                  <div className="qtitle">최근 4분기 순이익 (PER 계산에 사용)</div>
                  {fin.quarters.map((q: any, i: number) => (
                    <div className="qrow" key={i}>
                      <span>{fmtQ(q.period)}</span>
                      <span>{eok(q.netIncome)}</span>
                    </div>
                  ))}
                  {ttmNet != null && (
                    <div className="qrow qsum">
                      <span>합계 (최근 1년)</span>
                      <span>{eok(ttmNet)}</span>
                    </div>
                  )}
                </div>
              )}

              {manualQ.length > 0 && (
                <div className="fin-note">※ page.tsx의 직접 입력값으로 계산 중</div>
              )}
              {perCalc != null && (
                <div className="fin-note">→ PER = 시가총액 ÷ 위 순이익 합 = {perText}</div>
              )}
            </>
          ) : fin && fin.error ? (
            <div className="err">{fin.error}</div>
          ) : (
            <div className="skeleton">재무 불러오는 중…</div>
          ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("ko-KR"));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="wrap">
      <div className="header">
        <h1>📈 <span>삼성전자</span> · <span>SK하이닉스</span> 트래커</h1>
        <div className="meta">
          <span className="refresh-dot" />30초마다 자동 갱신 · {now}
        </div>
      </div>

      <div className="grid">
        {STOCKS.map((s) => (
          <StockCard key={s.code} code={s.code} name={s.name} color={s.color} />
        ))}
      </div>

      <div className="foot">
        데이터: 한국투자증권 KIS Open API · 뉴스: Google News<br />
        <span className="warn">※ 본 화면은 학습용 정보 제공이며 투자 권유가 아닙니다.</span>
      </div>
    </div>
  );
}
