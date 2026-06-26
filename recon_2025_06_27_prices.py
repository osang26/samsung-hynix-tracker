# -*- coding: utf-8 -*-
# 2025 러셀 리밸런싱 발효일(2025-06-27 금) — INSM/AUR/SMMT/PRMB/SFM
# 사용법: pip install yfinance pandas  ->  python recon_2025_06_27_prices.py
import yfinance as yf
import pandas as pd

tickers = ['INSM', 'AUR', 'SMMT', 'PRMB', 'SFM']
data = yf.download(tickers, start='2025-06-20', end='2025-07-01',
                   auto_adjust=False, progress=False, group_by='ticker')

print("\n=== 2025-06-27 (러셀 리밸런싱 발효일) ===")
print(f"{'종목':<6}{'시가':>10}{'종가':>10}{'등락률':>10}{'고가':>10}{'저가':>10}{'거래량':>14}")
for t in tickers:
    try:
        df = data[t].dropna(how='all')
    except KeyError:
        print(f"{t:<6}  (다운로드 실패)"); continue
    df.index = pd.to_datetime(df.index)
    key = pd.Timestamp('2025-06-27')
    if key not in df.index:
        print(f"{t:<6}  (6/27 데이터 없음)"); continue
    d = df.loc[key]
    prev = df.loc[:pd.Timestamp('2025-06-26')]
    pc = prev['Close'].iloc[-1] if len(prev) else float('nan')
    chg = (d['Close'] / pc - 1) * 100
    print(f"{t:<6}{d['Open']:>10.2f}{d['Close']:>10.2f}{chg:>9.2f}%{d['High']:>10.2f}{d['Low']:>10.2f}{int(d['Volume']):>14,}")

print("\n=== 참고: 리밸런싱 주간(6/23~6/27) 종가 ===")
closes = {}
for t in tickers:
    try:
        df = data[t].dropna(how='all'); df.index = pd.to_datetime(df.index)
        closes[t] = df.loc['2025-06-23':'2025-06-27', 'Close']
    except Exception:
        pass
print(pd.DataFrame(closes).round(2).to_string())

# CSV로도 저장
out = data
out.to_csv('recon_2025_06_27_raw.csv')
print("\n[저장] recon_2025_06_27_raw.csv")
