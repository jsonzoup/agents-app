import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "熵衍之墨 · draft studio",
  description: "为新媒体文章创作服务的本地工作台，连接素材研究、选题、写作、审校与多平台交付",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
