# -*- coding: utf-8 -*-
# 리밸런싱 다음 주(2025-06-30 ~ 07-04) 주가 흐름 — INSM/AUR/SMMT/PRMB/SFM
# 참고: 2025-07-04(금) 미국 독립기념일 휴장 → 6/30·7/1·7/2·7/3 4거래일
# 사용법: python week_after_recon_2025.py
import yfinance as yf
import pandas as pd

tickers = ['INSM', 'AUR', 'SMMT', 'PRMB', 'SFM']
data = yf.download(tickers, start='2025-06-26', end='2025-07-08',
                   auto_adjust=False, progress=False, group_by='ticker')

close = pd.DataFrame({t: data[t]['Close']  for t in tickers})
vol   = pd.DataFrame({t: data[t]['Volume'] for t in tickers})
close.index = pd.to_datetime(close.index)
vol.index   = pd.to_datetime(vol.index)
ret = close.pct_change() * 100

wk = slice('2025-06-30', '2025-07-04')

print("\n=== 일별 종가 (2025-06-30 ~ 07-03, 7/4 휴장) ===")
print(close.loc[wk].round(2).to_string())

print("\n=== 일별 등락률 (%) ===")
print(ret.loc[wk].round(2).to_string())

print("\n=== 일별 거래량 ===")
print(vol.loc[wk].astype('Int64').to_string())

cum = (close.loc['2025-07-03'] / close.loc['2025-06-27'] - 1) * 100
print("\n=== 그 주 누적 등락률 (6/27 종가 -> 7/3 종가) ===")
print(cum.round(2).sort_values().to_string())

data.to_csv('week_after_recon_2025.csv')
print("\n[저장] week_after_recon_2025.csv")
