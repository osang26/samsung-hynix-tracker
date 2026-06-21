"use client";

import { useEffect, useState, useCallback } from "react";
import {
  LineChart,
  BarChart,
  Line,
  Bar,
  Cell,
  Legend,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { INSIGHTS } from "@/lib/insights";

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

// 사업부문 스택 막대 색(진한→옅은 파랑)
const SEG_COLORS = ["#3b6fe0", "#86a8ef", "#c2d4f7", "#dde7fa"];

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
function eokAmount(w: any): string {
  const n = Number(w) || 0;
  if (n <= 0) return "-";
  const eok = n / 1e8;
  if (eok >= 10000) return (eok / 10000).toFixed(1) + "조";
  if (eok >= 1) return Math.round(eok).toLocaleString("ko-KR") + "억";
  return Math.round(n / 1e4).toLocaleString("ko-KR") + "만";
}
function pct52(price: number, low: number, high: number): number {
  if (!(high > low)) return 50;
  return Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
}
// 한국식 날짜: 2026.6.21. 일  (YYYYMMDD 문자열·RSS 날짜·Date 모두 처리)
const WD = ["일", "월", "화", "수", "목", "금", "토"];
function kDate(input: any): string {
  if (input === null || input === undefined || input === "") return "";
  let dt: Date;
  if (input instanceof Date) dt = input;
  else {
    const s = String(input).trim();
    dt = /^\d{8}$/.test(s)
      ? new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))
      : new Date(s);
  }
  if (isNaN(dt.getTime())) return String(input);
  return `${dt.getFullYear()}.${dt.getMonth() + 1}.${dt.getDate()}. ${WD[dt.getDay()]}`;
}
function qLabel(p: string): string {
  if (!p || p.length < 6) return p || "";
  const q: Record<string, string> = { "03": "1Q", "06": "2Q", "09": "3Q", "12": "4Q" };
  return p.slice(2, 4) + "." + (q[p.slice(4, 6)] || "?");
}
function yLabel(p: string): string {
  return p && p.length >= 4 ? p.slice(0, 4) : p || "";
}
function eokAxis(v: any): string {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 10000) return Math.round(n / 10000) + "조";
  return Math.round(n) + "억";
}

function StockCard({ code, name, color, quote, tab, setTab }: { code: string; name: string; color: string; quote: any; tab: string; setTab: (t: string) => void }) {
  const qErr = quote && quote.error ? quote.error : "";
  const [chart, setChart] = useState<any>(null);
  const [fin, setFin] = useState<any>(null);
  const [news, setNews] = useState<any>(null);
  const [daily, setDaily] = useState<any>(null);
  const [consensus, setConsensus] = useState<any>(null);
  const [disclosure, setDisclosure] = useState<any>(null);
  const [range, setRange] = useState("1D"); // 1D 1W 1M 3M 1Y (기본: 1일)
  const [newsTab, setNewsTab] = useState("news"); // 뉴스 탭 안의 서브탭: news | disc
  const [finMode, setFinMode] = useState("q"); // 재무: q(분기) | y(연간)

  // 메인 탭(차트/뉴스/재무)이 바뀌면 뉴스 서브탭은 '뉴스'로 초기화
  useEffect(() => {
    setNewsTab("news");
  }, [tab]);

  // 재무 / 뉴스: 1회
  useEffect(() => {
    fetch(`/api/financials?code=${code}`).then((r) => r.json()).then(setFin).catch(() => setFin({ error: "재무 오류" }));
    fetch(`/api/news?q=${encodeURIComponent(name)}`).then((r) => r.json()).then(setNews).catch(() => setNews({ error: "뉴스 오류" }));
    fetch(`/api/daily?code=${code}`).then((r) => r.json()).then(setDaily).catch(() => setDaily({ error: "일별시세 오류" }));
    fetch(`/api/consensus?code=${code}`).then((r) => r.json()).then(setConsensus).catch(() => setConsensus(null));
    fetch(`/api/disclosure?code=${code}`).then((r) => r.json()).then(setDisclosure).catch(() => setDisclosure(null));
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

  // 컨센서스 상승여력 = (평균 목표가 - 현재가) / 현재가
  const consUpside =
    consensus && consensus.avgTarget && quote && quote.price
      ? ((consensus.avgTarget - quote.price) / quote.price) * 100
      : null;

  // 재무: 표시 목록(분기/연간) + 현재 PER / 포워드 PER
  const finList = fin && !fin.error ? (finMode === "q" ? fin.quarterly || [] : fin.annual || []) : [];
  const finCap = quote && quote.marketCap ? quote.marketCap : null;
  const trailPer = finCap && fin && fin.ttmNet ? finCap / fin.ttmNet : null;
  const fwdPer = finCap && fin && fin.forwardNet ? finCap / fin.forwardNet : null;

  // 투자포인트(정적): 요약 + 강세/약세 + 사업부문
  const insight = INSIGHTS[code];

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
      {quote && !quote.error && (
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
        <button className={"tab-btn" + (tab === "tip" ? " active" : "")} onClick={() => setTab("tip")}>투자포인트</button>
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
                    <Tooltip formatter={(v: any) => won(v)} contentStyle={{ background: "#ffffff", border: "1px solid #e8edf4", borderRadius: 8, fontSize: 12, color: "#1b2434", boxShadow: "0 2px 10px rgba(20,40,80,0.12)" }} />
                    <Line type="monotone" dataKey="close" name="가격" stroke={color} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="vol-cap">거래량</div>
                <ResponsiveContainer width="100%" height={58}>
                  <BarChart data={chart.series} margin={{ top: 0, right: 8, left: 8, bottom: 0 }} barCategoryGap={0}>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#7e8ca6" }} minTickGap={36} />
                    <YAxis width={50} tick={{ fontSize: 9, fill: "#7e8ca6" }} tickFormatter={(v: any) => compactVol(v)} />
                    <Tooltip formatter={(v: any) => Number(v).toLocaleString("ko-KR") + "주"} contentStyle={{ background: "#ffffff", border: "1px solid #e8edf4", borderRadius: 8, fontSize: 12, color: "#1b2434", boxShadow: "0 2px 10px rgba(20,40,80,0.12)" }} />
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

            {quote && quote.high52 > 0 && quote.low52 > 0 && (
              <div className="block52">
                <div className="sec">52주 범위</div>
                <div className="r52-track">
                  <div className="r52-dot" style={{ left: pct52(quote.price, quote.low52, quote.high52) + "%" }} />
                </div>
                <div className="r52-ends">
                  <span>최저 <b className="down">{won(quote.low52)}</b></span>
                  <span>최고 <b className="up">{won(quote.high52)}</b></span>
                </div>
              </div>
            )}

            {consensus && consensus.count > 0 && (
              <div className="consensus">
                <div className="sec">증권가 컨센서스 <span className="sub">최근 6개월 · KIS</span></div>
                <div className="cons-top">
                  <div className="cons-cell">
                    <div className="k">평균 목표가</div>
                    <div className="v">{consensus.avgTarget ? won(consensus.avgTarget) : "-"}</div>
                  </div>
                  <div className="cons-cell">
                    <div className="k">상승여력</div>
                    <div className={"v " + (consUpside == null ? "" : consUpside >= 0 ? "up" : "down")}>
                      {consUpside == null ? "-" : (consUpside >= 0 ? "+" : "") + consUpside.toFixed(1) + "%"}
                    </div>
                  </div>
                </div>
                <div className="cons-ops">
                  <span className="up">매수 {consensus.buy}</span>
                  <span className="flat">보유 {consensus.hold}</span>
                  <span className="down">매도 {consensus.sell}</span>
                  <span className="cons-cnt">· 분석 {consensus.count}곳</span>
                </div>
                <div className="cons-bar">
                  {consensus.buy > 0 && <div className="seg up" style={{ flexGrow: consensus.buy }} />}
                  {consensus.hold > 0 && <div className="seg flat" style={{ flexGrow: consensus.hold }} />}
                  {consensus.sell > 0 && <div className="seg down" style={{ flexGrow: consensus.sell }} />}
                </div>
              </div>
            )}

            {daily && daily.rows && daily.rows.length > 0 && (
              <div className="dailytable">
                <div className="sec">일별 시세 <span className="sub">최근 30일 · KIS</span></div>
                <div className="dt-head">
                  <span>날짜</span><span>종가</span><span>등락률</span><span>거래량</span><span>거래대금</span>
                </div>
                <div className="dt-body">
                  {daily.rows.map((d: any, i: number) => (
                    <div className="dt-row" key={i}>
                      <span>{d.date}</span>
                      <span>{Number(d.close).toLocaleString("ko-KR")}</span>
                      <span className={d.changeRate > 0 ? "up" : d.changeRate < 0 ? "down" : "flat"}>
                        {(d.changeRate > 0 ? "+" : "") + Number(d.changeRate).toFixed(2)}%
                      </span>
                      <span>{compactVol(d.volume)}</span>
                      <span>{eokAmount(d.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tab === "news" && (
          <>
            <div className="subtabs">
              <button className={"subtab" + (newsTab === "news" ? " active" : "")} onClick={() => setNewsTab("news")}>📰 뉴스</button>
              <button className={"subtab" + (newsTab === "disc" ? " active" : "")} onClick={() => setNewsTab("disc")}>📋 공시</button>
            </div>

            {newsTab === "news" ? (
              news && news.items && news.items.length > 0 ? (
                <ul className="news">
                  {news.items.map((it: any, i: number) => (
                    <li key={i}>
                      <a href={it.link} target="_blank" rel="noreferrer">{it.title}</a>
                      <div className="date">{it.source ? it.source + " · " : ""}{kDate(it.pubDate)}</div>
                    </li>
                  ))}
                </ul>
              ) : news && news.error ? (
                <div className="err">{news.error}</div>
              ) : (
                <div className="skeleton">뉴스 불러오는 중…</div>
              )
            ) : disclosure && disclosure.items && disclosure.items.length > 0 ? (
              <ul className="news">
                {disclosure.items.map((d: any, i: number) => (
                  <li key={i}>
                    <a href={d.url} target="_blank" rel="noreferrer">{d.title}</a>
                    <div className="date">{d.filer ? d.filer + " · " : ""}{kDate(d.date)}</div>
                  </li>
                ))}
              </ul>
            ) : disclosure && disclosure.enabled === false ? (
              <div className="fin-note">공시를 보려면 DART API 키가 필요해요. (opendart.fss.or.kr 무료 발급 → 환경변수 DART_API_KEY)</div>
            ) : disclosure && disclosure.items ? (
              <div className="fin-note">최근 3개월 공시가 없습니다.</div>
            ) : (
              <div className="skeleton">공시 불러오는 중…</div>
            )}
          </>
        )}

        {tab === "fin" &&
          (fin && fin.error ? (
            <div className="err">{fin.error}</div>
          ) : !fin ? (
            <div className="skeleton">재무 불러오는 중…</div>
          ) : (
            <>
              <div className="subtabs">
                <button className={"subtab" + (finMode === "q" ? " active" : "")} onClick={() => setFinMode("q")}>분기</button>
                <button className={"subtab" + (finMode === "y" ? " active" : "")} onClick={() => setFinMode("y")}>연간</button>
              </div>

              <div className="chartbox" style={{ height: 196 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={finList.map((d: any) => ({ ...d, label: finMode === "q" ? qLabel(d.period) : yLabel(d.period) }))}
                    margin={{ top: 8, right: 6, left: 6, bottom: 0 }}
                    barCategoryGap="22%"
                  >
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#7e8ca6" }} />
                    <YAxis width={48} tick={{ fontSize: 9, fill: "#7e8ca6" }} tickFormatter={eokAxis} />
                    <Tooltip
                      formatter={(v: any, n: any) => [eok(v), n]}
                      contentStyle={{ background: "#ffffff", border: "1px solid #e8edf4", borderRadius: 8, fontSize: 12, color: "#1b2434", boxShadow: "0 2px 10px rgba(20,40,80,0.12)" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="revenue" name="매출" fill="#3b6fe0" radius={[3, 3, 0, 0]}>
                      {finList.map((d: any, i: number) => (
                        <Cell key={i} fill={d.forecast ? "#cfe0ff" : "#3b6fe0"} stroke={d.forecast ? "#3b6fe0" : undefined} strokeWidth={d.forecast ? 1.4 : 0} strokeDasharray={d.forecast ? "4 3" : undefined} />
                      ))}
                    </Bar>
                    <Bar dataKey="netIncome" name="순이익" fill="#e5453b" radius={[3, 3, 0, 0]}>
                      {finList.map((d: any, i: number) => (
                        <Cell key={i} fill={d.forecast ? "#f6cfcc" : "#e5453b"} stroke={d.forecast ? "#e5453b" : undefined} strokeWidth={d.forecast ? 1.4 : 0} strokeDasharray={d.forecast ? "4 3" : undefined} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="fin-note">점선 막대 = 예측치(추정) · 실제 3 + 예측 1 · KIS 손익계산서</div>

              <div className="tfin">
                <div className="tfin-row head" style={{ gridTemplateColumns: `0.8fr repeat(${finList.length}, 1fr)` }}>
                  <span>구분</span>
                  {finList.map((d: any, i: number) => {
                    const lbl = finMode === "q" ? qLabel(d.period) : yLabel(d.period);
                    return (
                      <span key={i} className={d.forecast ? "fc" : ""}>
                        {lbl}{d.forecast && <><br /><small className="fc-tag">예측</small></>}
                      </span>
                    );
                  })}
                </div>
                <div className="tfin-row" style={{ gridTemplateColumns: `0.8fr repeat(${finList.length}, 1fr)` }}>
                  <span>매출</span>
                  {finList.map((d: any, i: number) => (
                    <span key={i} className={d.forecast ? "fc" : ""}>{eok(d.revenue)}</span>
                  ))}
                </div>
                <div className="tfin-row" style={{ gridTemplateColumns: `0.8fr repeat(${finList.length}, 1fr)` }}>
                  <span>순이익</span>
                  {finList.map((d: any, i: number) => (
                    <span key={i} className={d.forecast ? "fc" : ""}>{eok(d.netIncome)}</span>
                  ))}
                </div>
              </div>

              <div className="sec">PER</div>
              <div className="cons-top">
                <div className="cons-cell">
                  <div className="k">현재 PER <span className="sub">실적</span></div>
                  <div className="v">{trailPer ? trailPer.toFixed(1) + "배" : "-"}</div>
                </div>
                <div className="cons-cell">
                  <div className="k">포워드 PER <span className="sub">예측</span></div>
                  <div className="v">{fwdPer ? fwdPer.toFixed(1) + "배" : "-"}</div>
                </div>
              </div>
            </>
          ))}

        {tab === "tip" && insight && (
          <>
            <div className="tip-hero">
              <span className="tip-hero-label">핵심 한 줄</span>
              <div className="tip-hero-text">{insight.summary}</div>
            </div>

            <div className="sec">사업부문 구성 <span className="sub">{insight.segNote}</span></div>
            <div className="segbar">
              {insight.segments.map((s: any, i: number) => (
                <div key={i} className="segbar-part" style={{ width: s.pct + "%", background: SEG_COLORS[i % SEG_COLORS.length] }}>
                  {s.pct >= 15 ? s.pct + "%" : ""}
                </div>
              ))}
            </div>
            <div className="seg-legend">
              {insight.segments.map((s: any, i: number) => (
                <div className="seg-leg" key={i}>
                  <span className="seg-dot" style={{ background: SEG_COLORS[i % SEG_COLORS.length] }} />
                  <span className="seg-leg-name">{s.label}</span>
                  <span className="seg-leg-pct">{s.pct}%</span>
                  {s.note && <span className="seg-note">· {s.note}</span>}
                </div>
              ))}
            </div>

            <div className="sec">투자 포인트</div>
            <div className="bullbear">
              <div className="bb bb-bull">
                <div className="bb-head"><span className="bb-ico">📈</span><span className="bb-title">강세 · Bull</span><span className="bb-cnt">{insight.bull.length}</span></div>
                <ul>{insight.bull.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
              </div>
              <div className="bb bb-bear">
                <div className="bb-head"><span className="bb-ico">📉</span><span className="bb-title">약세 · Bear</span><span className="bb-cnt">{insight.bear.length}</span></div>
                <ul>{insight.bear.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
              </div>
            </div>
            <div className="fin-note">첨부 투자분석보고서(증권사 컨센서스 등) 요약 · 투자 권유 아님</div>
          </>
        )}
        {tab === "tip" && !insight && <div className="muted">자료 준비 중입니다.</div>}
      </div>
    </div>
  );
}

export default function Home() {
  const [now, setNow] = useState("");
  const [active, setActive] = useState(STOCKS[0].code);
  const [quotes, setQuotes] = useState<any>({}); // { code: quoteData }
  const [tab, setTab] = useState("chart"); // 서브탭(차트/뉴스/재무) — 종목 바꿔도 유지

  // 두 종목 현재가 5초마다 (상위 탭 표시 + 활성 카드용)
  const loadQuotes = useCallback(async () => {
    await Promise.all(
      STOCKS.map(async (s) => {
        try {
          const r = await fetch(`/api/quote?code=${s.code}`);
          const d = await r.json();
          setQuotes((prev: any) => ({ ...prev, [s.code]: d }));
        } catch {
          setQuotes((prev: any) => ({ ...prev, [s.code]: { error: "네트워크 오류" } }));
        }
      })
    );
  }, []);
  useEffect(() => {
    loadQuotes();
    const id = setInterval(loadQuotes, 5000);
    return () => clearInterval(id);
  }, [loadQuotes]);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(`${kDate(d)} ${d.toLocaleTimeString("ko-KR")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const activeStock = STOCKS.find((s) => s.code === active) || STOCKS[0];

  return (
    <div className="wrap">
      <div className="header">
        <h1>📈 <span>삼성전자</span> · <span>SK하이닉스</span> 트래커</h1>
        <div className="meta">
          <span className="refresh-dot" />5초마다 자동 갱신 · {now}
        </div>
      </div>

      {/* 상위 종목 탭 (각 탭에 현재가·등락률 표시, 누르면 전환) */}
      <div className="stock-tabs">
        {STOCKS.map((s) => {
          const q = quotes[s.code];
          const ok = q && !q.error;
          return (
            <button
              key={s.code}
              className={"stock-tab" + (active === s.code ? " active" : "")}
              onClick={() => setActive(s.code)}
            >
              <div className="st-name">{s.name} <span className="st-code">{s.code}</span></div>
              {ok ? (
                <div className="st-q">
                  <span className="st-price">{won(q.price)}</span>
                  <span className={"st-chg " + dirClass(q.dir)}>{arrow(q.dir)} {q.changeRate}%</span>
                </div>
              ) : (
                <div className="st-q"><span className="st-price" style={{ color: "var(--muted)" }}>…</span></div>
              )}
            </button>
          );
        })}
      </div>

      {/* 선택한 종목만 풀 카드 (key로 종목 전환 시 새로 마운트) */}
      <StockCard
        key={activeStock.code}
        code={activeStock.code}
        name={activeStock.name}
        color={activeStock.color}
        quote={quotes[activeStock.code]}
        tab={tab}
        setTab={setTab}
      />

      <div className="foot">
        데이터: 한국투자증권 KIS Open API · 뉴스: Google News<br />
        <span className="warn">※ 본 화면은 학습용 정보 제공이며 투자 권유가 아닙니다.</span>
      </div>
    </div>
  );
}
