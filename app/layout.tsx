import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "삼성전자 · SK하이닉스 트래커",
  description: "KIS Open API로 삼성전자와 SK하이닉스의 현재가·차트·재무·뉴스를 한눈에",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
