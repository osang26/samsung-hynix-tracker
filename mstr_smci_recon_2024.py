# -*- coding: utf-8 -*-
# MSTR / SMCI — 2024-06-28(러셀 발효일) + 7/1~7/5 (7/4 휴장)
# 사용법: python mstr_smci_recon_2024.py
# 참고: 2024년 두 종목 10:1 분할 -> 6월 종가는 분할 조정가로 표시(등락률은 동일)
import yfinance as yf
import pandas as pd

tickers = ['MSTR', 'SMCI']
data = yf.download(tickers, start='2024-06-25', end='2024-07-09',
                   auto_adjust=False, progress=False, group_by='ticker')

close = pd.DataFrame({t: data[t]['Close']  for t in tickers})
open_ = pd.DataFrame({t: data[t]['Open']   for t in tickers})
vol   = pd.DataFrame({t: data[t]['Volume'] for t in tickers})
close.index = pd.to_datetime(close.index)
ret = close.pct_change() * 100

print("=== 2024-06-28 (러셀 리밸런싱 발효일) ===")
print(f"{'종목':<6}{'시가':>10}{'종가':>10}{'등락률':>10}{'거래량':>14}")
d28, d27 = pd.Timestamp('2024-06-28'), pd.Timestamp('2024-06-27')
for t in tickers:
    o, c, pc, v = open_[t][d28], close[t][d28], close[t][d27], vol[t][d28]
    print(f"{t:<6}{o:>10.2f}{c:>10.2f}{(c/pc-1)*100:>9.2f}%{int(v):>14,}")

print("\n=== 2024-07-01 ~ 07-05 일별 종가(등락률) — 7/4 휴장 ===")
wk = slice('2024-07-01', '2024-07-05')
disp = pd.DataFrame(index=[d.date() for d in close.loc[wk].index])
for t in tickers:
    disp[f'{t} 종가']  = close[t].loc[wk].round(2).values
    disp[f'{t} 등락%'] = ret[t].loc[wk].round(2).values
print(disp.to_string())

data.to_csv('mstr_smci_recon_2024.csv')
print("\n[저장] mstr_smci_recon_2024.csv")
