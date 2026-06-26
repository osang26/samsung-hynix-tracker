#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
러셀 2000 -> 1000 졸업 종목의 2025년 리밸런싱 주간 일별 주가 변화 분석
------------------------------------------------------------------
- 2025년 리밸런싱 발효: 2025-06-27(금) 종가 후
- 신규 지수 개장      : 2025-06-30(월)
- 분석 주간          : 2025-06-23(월) ~ 2025-06-30(월)

[사용법]
1) pip install yfinance pandas
2) 아래 GRADUATES 딕셔너리에 19개 졸업 종목 티커를 모두 채운다.
   (현재는 FTSE Russell 공식 리캡에 명시된 5개만 들어 있음 → 나머지 14개 추가 필요)
3) python russell_recon_2025_weekly.py

[주의]
- yfinance 는 Yahoo Finance 데이터를 사용합니다. 일부 폐쇄망에서는 차단될 수 있습니다.
- auto_adjust=True 라 배당/분할이 조정된 종가 기준입니다(1주일 구간이라 영향은 미미).
- 일부 종목은 이후 합병/상장폐지로 티커가 바뀌었을 수 있으니, 다운로드 실패 목록을 확인하세요.
"""

import sys
import pandas as pd

try:
    import yfinance as yf
except ImportError:
    sys.exit("yfinance 가 필요합니다:  pip install yfinance pandas")

# ── 2025년 러셀 2000 -> 1000 졸업 종목 (총 19개) ───────────────────────────
# 아래 5개는 FTSE Russell 2025 리캡(공식)에 명시된 종목.
# 나머지 14개는 FTSE Russell 멤버십 파일에서 확인 후 추가하세요.
GRADUATES = {
    "SMMT": "Summit Therapeutics",
    "SFM":  "Sprouts Farmers Market",
    "INSM": "Insmed",
    "AUR":  "Aurora Innovation",
    "PRMB": "Primo Brands",
    # "TICKER": "회사명",   ← 여기에 나머지 14개 추가
}

# 비교용 벤치마크 ETF
BENCH = {
    "IWM": "Russell 2000 ETF",
    "IWB": "Russell 1000 ETF",
}

# 직전 거래일(기준 종가)을 확보하려고 시작일을 주간보다 앞당김
START = "2025-06-18"
END   = "2025-07-01"          # yfinance end 는 배타적 → 6/30 포함
WEEK_START = "2025-06-23"
WEEK_END   = "2025-06-30"
RECON_DAY  = "2025-06-27"     # 리밸런싱 발효일(금)


def fetch_close(tickers):
    """종가만 다운로드해서 DataFrame(columns=ticker) 으로 반환."""
    data = yf.download(
        list(tickers), start=START, end=END,
        auto_adjust=True, progress=False, group_by="column",
    )
    close = data["Close"] if "Close" in data else data
    if isinstance(close, pd.Series):
        close = close.to_frame()
    return close.dropna(axis=1, how="all")


def main():
    all_tickers = list(GRADUATES) + list(BENCH)
    close = fetch_close(all_tickers)

    got = set(close.columns)
    missing = [t for t in all_tickers if t not in got]
    if missing:
        print(f"[경고] 다운로드 실패 티커: {', '.join(missing)}\n")

    # 일별 수익률(%) = 전일 종가 대비 변화율
    rets = (close.pct_change() * 100).loc[WEEK_START:WEEK_END]

    grad_cols  = [t for t in GRADUATES if t in got]
    bench_cols = [t for t in BENCH if t in got]

    if not grad_cols:
        sys.exit("졸업 종목 데이터를 하나도 받지 못했습니다. 티커를 확인하세요.")

    pd.set_option("display.width", 140)
    pd.set_option("display.max_columns", 30)

    print("=" * 60)
    print("졸업 종목 일별 수익률 (%, 종가 기준)")
    print("=" * 60)
    tbl = rets[grad_cols].copy()
    tbl.index = tbl.index.strftime("%m/%d(%a)")
    print(tbl.round(2).to_string())

    print("\n" + "=" * 60)
    print("요약")
    print("=" * 60)
    eq_avg = rets[grad_cols].mean(axis=1)          # 동일가중 평균 일별 수익률
    cum    = (1 + rets[grad_cols] / 100).prod() - 1 # 종목별 주간 누적 수익률(%)

    summary = pd.DataFrame({
        "졸업_동일가중_평균(%)": eq_avg.round(2),
    })
    for t in bench_cols:
        summary[f"{t}(%)"] = rets[t].round(2)
    summary.index = summary.index.strftime("%m/%d(%a)")
    print(summary.to_string())

    print("\n주간 누적 수익률 (6/23~6/30, %)")
    print((cum * 100).round(2).sort_values(ascending=False).to_string())
    print(f"\n  · 졸업 바스켓 동일가중 누적 평균: {(cum.mean()*100):.2f}%")
    for t in bench_cols:
        c = (1 + rets[t] / 100).prod() - 1
        print(f"  · {BENCH[t]} ({t}): {c*100:.2f}%")

    # 리밸런싱 발효일 강조
    ts = pd.Timestamp(RECON_DAY)
    if ts in rets.index:
        row = rets.loc[ts]
        print("\n" + "=" * 60)
        print(f"리밸런싱 발효일 {RECON_DAY}(금) — 1년 중 거래량이 가장 몰리는 날")
        print("=" * 60)
        print(f"  졸업 바스켓 동일가중 평균: {row[grad_cols].mean():.2f}%")
        for t in bench_cols:
            print(f"  {BENCH[t]} ({t}): {row[t]:.2f}%")

    out = "russell_recon_2025_returns.csv"
    rets.round(4).to_csv(out, encoding="utf-8-sig")
    print(f"\n[저장] {out}")


if __name__ == "__main__":
    main()
