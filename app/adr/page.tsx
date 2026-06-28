"use client";

import { useEffect, useState } from "react";

// SK하이닉스 나스닥 ADR 공모가 시뮬레이터
//  공모가($) = 기준가(원) × 전환비율(0.1) ÷ 환율(원/$) × (1 − 할인율)
const RATIO = 0.1; // ADR 1주 = 원주 0.1주 (1:10)
const CODE = "000660";

function won(n: any): string {
  return Number(n || 0).toLocaleString("ko-KR");
}

export default function Adr() {
  const [livePrice, setLivePrice] = useState<number | null>(null); // 하이닉스 현재가(원)
  const [liveFx, setLiveFx] = useState<number | null>(null); // 원/달러
  const [fxUpdated, setFxUpdated] = useState("");
  const [discount, setDiscount] = useState("3"); // 할인율(%) — 수동
  const [priceOv, setPriceOv] = useState(""); // 기준가 직접 입력(선택)
  const [fxOv, setFxOv] = useState(""); // 환율 직접 입력(선택)
  const [now, setNow] = useState("");

  // 하이닉스 현재가 10초마다
  useEffect(() => {
    const load = () =>
      fetch(`/api/quote?code=${CODE}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => { if (d && d.price) setLivePrice(d.price); })
        .catch(() => {});
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  // 환율 10분마다
  useEffect(() => {
    const load = () =>
      fetch(`/api/fx`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => { if (d && d.rate) { setLiveFx(d.rate); setFxUpdated(d.updated || ""); } })
        .catch(() => {});
    load();
    const id = setInterval(load, 600000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toLocaleTimeString("ko-KR")), 1000);
    return () => clearInterval(id);
  }, []);

  const basePrice = priceOv !== "" && Number(priceOv) > 0 ? Number(priceOv) : livePrice;
  const baseFx = fxOv !== "" && Number(fxOv) > 0 ? Number(fxOv) : liveFx;
  const dpct = Math.max(0, Math.min(50, Number(discount) || 0));

  const pure = basePrice && baseFx ? (basePrice * RATIO) / baseFx : null; // 순수 환산가 $
  const ipo = pure != null ? pure * (1 - dpct / 100) : null; // 공모가 $

  const fmt$ = (v: number | null) => (v == null ? "—" : "$" + v.toFixed(2));

  return (
    <div className="adr">
      <div className="adr-head">
        <h1>🇺🇸 SK하이닉스 ADR 공모가 시뮬레이터</h1>
        <div className="adr-sub">나스닥 ADR(1:10) · 기준가·환율 자동 · 할인율 직접 입력</div>
      </div>

      {/* 자동 수집 기준값 */}
      <div className="adr-live">
        <div className="adr-livecard">
          <div className="k"><span className="refresh-dot" />하이닉스 현재가</div>
          <div className="v">{livePrice ? "₩" + won(livePrice) : "불러오는 중…"}</div>
          <div className="t">실시간 · {now}</div>
        </div>
        <div className="adr-livecard">
          <div className="k"><span className="refresh-dot" />원/달러 환율</div>
          <div className="v">{liveFx ? won(liveFx) + "원" : "불러오는 중…"}</div>
          <div className="t">{fxUpdated ? "갱신 " + fxUpdated.replace(/ \(.*\)/, "") : "open.er-api"}</div>
        </div>
      </div>

      {/* 할인율 입력 */}
      <div className="adr-sec">할인율 (수동 입력)</div>
      <div className="adr-disc">
        {["2", "3", "5"].map((p) => (
          <button key={p} className={"adr-preset" + (discount === p ? " on" : "")} onClick={() => setDiscount(p)}>{p}%</button>
        ))}
        <div className="adr-inp">
          <input type="number" value={discount} min={0} max={50} step={0.5} onChange={(e) => setDiscount(e.target.value)} />
          <span>%</span>
        </div>
      </div>

      {/* 결과 */}
      <div className="adr-result">
        <div className="adr-rlabel">예상 ADR 공모가</div>
        <div className="adr-rprice">{fmt$(ipo)}</div>
        <div className="adr-calc">
          순수 환산가 {fmt$(pure)} × (1 − {dpct}%) ={" "}
          {basePrice && baseFx ? `${won(basePrice)}원 × ${RATIO} ÷ ${won(baseFx)}원` : "기준가·환율 대기"}
        </div>
      </div>

      {/* 할인율별 시나리오 */}
      <div className="adr-sec">할인율별 시나리오</div>
      <div className="adr-table">
        <div className="adr-th"><span>할인율</span><span>공모가($)</span><span>현재가 대비</span></div>
        {[2, 3, 5].map((d) => {
          const v = pure != null ? pure * (1 - d / 100) : null;
          return (
            <div className="adr-tr" key={d}>
              <span>{d}% 할인</span>
              <span className="adr-v">{fmt$(v)}</span>
              <span className="muted">{v != null ? "−" + d + "%" : "—"}</span>
            </div>
          );
        })}
      </div>

      {/* 기준값 직접 입력(선택) */}
      <div className="adr-sec">기준값 직접 입력 <span className="adr-opt">(비우면 자동값 사용)</span></div>
      <div className="adr-ov">
        <label>기준가(원)<input type="number" placeholder={livePrice ? String(livePrice) : "자동"} value={priceOv} onChange={(e) => setPriceOv(e.target.value)} /></label>
        <label>환율(원/$)<input type="number" placeholder={liveFx ? String(liveFx) : "자동"} value={fxOv} onChange={(e) => setFxOv(e.target.value)} /></label>
      </div>

      <div className="adr-note">
        ※ 시뮬레이션 값이에요. 실제 공모가는 주관사 수요예측·확정 환율에 따라 달라져요. (전환비율 ADR 1주 = 원주 0.1주)
      </div>
      <a className="wlink" href="/">전체 사이트로 이동 →</a>
    </div>
  );
}
