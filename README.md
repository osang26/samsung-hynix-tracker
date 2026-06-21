# 삼성전자 · SK하이닉스 트래커

삼성전자(005930)와 SK하이닉스(000660)의 **현재가·차트·재무·뉴스**를 한 화면에 나란히 보여주는 Next.js 앱입니다. IonQ 트래커와 비슷한 카드형 레이아웃이에요.

- **현재가·등락**: KIS 국내주식 현재가 (30초마다 자동 갱신, 상승 빨강·하락 파랑)
- **시가총액·PER·거래량·52주 고저**: 현재가 응답에서 함께 표시
- **주가 차트**: KIS 일봉(약 5개월) 라인 차트
- **재무**: KIS 손익계산서의 매출액·영업이익·순이익(연간)
- **뉴스**: 구글 뉴스 RSS (무료, 앱키 불필요)

> 주가 관련 데이터는 모두 **KIS Open API(무료)** 만 사용합니다. 뉴스만 별도 무료 소스(구글 뉴스)를 씁니다.

---

## 실행 방법

### 1) 준비물
- Node.js 20 이상
- KIS 앱키(App Key) · 앱시크릿(App Secret) — 보호자가 KIS Developers에서 발급

### 2) 앱키 넣기
`​.env.local.example` 파일을 복사해 **`.env.local`** 파일을 만들고 값을 채웁니다.

```
KIS_APP_KEY=발급받은_앱키
KIS_APP_SECRET=발급받은_앱시크릿
KIS_BASE=https://openapi.koreainvestment.com:9443
```

> ⚠️ `.env.local` 은 **절대 GitHub에 올리지 마세요.** (`.gitignore`에 이미 막혀 있습니다.)

### 3) 설치 & 실행
```bash
npm install
npm run dev
```
브라우저에서 http://localhost:3000 접속.

---

## 인터넷에 배포 (Vercel)
1. 이 폴더를 GitHub에 올립니다. (앱키가 든 `.env.local`은 빼고)
2. Vercel에서 이 저장소를 **Import**.
3. Vercel 프로젝트 **Settings → Environment Variables** 에 `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_BASE` 를 넣고 **Deploy**.

---

## 종목 바꾸기 / 더 추가하기
`lib/kis.ts` 의 `STOCKS` 와 `app/page.tsx` 상단의 `STOCKS` 배열에서 종목코드·이름을 바꾸면 됩니다.
예: 카카오 `035720`, 네이버 `035420`, 현대차 `005380`.

---

## 폴더 구조
```
samsung-hynix-tracker/
├─ app/
│  ├─ page.tsx          # 메인 화면(두 종목 카드)
│  ├─ layout.tsx        # 공통 틀
│  ├─ globals.css       # 디자인
│  └─ api/
│     ├─ quote/route.ts       # 현재가·등락·시총·PER
│     ├─ chart/route.ts       # 일봉 차트 데이터
│     ├─ financials/route.ts  # 매출·영업이익·순이익
│     └─ news/route.ts        # 구글 뉴스 RSS
├─ lib/kis.ts           # KIS 토큰 발급/호출 헬퍼
├─ .env.local.example   # 앱키 템플릿(복사해서 .env.local 생성)
└─ ...
```

---

## 참고
- 이 앱은 **시세·정보 조회(읽기)** 만 하며 매매 기능이 없습니다. 계좌번호도 사용하지 않습니다.
- 본 화면은 **학습용 정보 제공**이며 투자 권유가 아닙니다.
- 이 프로젝트는 IonQ 트래커와 별개인 **독립 프로젝트**입니다. 원하면 `ionq-tracker` 밖으로 옮겨 별도 GitHub 저장소로 관리하세요.
