import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "照片 LUT 工作台",
  description: "在浏览器本地为 iPhone 和松下照片应用富士胶片风格。",
  icons: {
    icon: "./favicon.svg",
    shortcut: "./favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
