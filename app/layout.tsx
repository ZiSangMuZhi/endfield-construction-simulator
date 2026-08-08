import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
export const dynamic="force-static";

const githubPages=process.env.GITHUB_PAGES==="true";
const siteOrigin=githubPages?"https://zisangmuzhi.github.io":"https://endfield-construction-planner.zisangmuzhi.chatgpt.site";
const siteBasePath=githubPages?"/endfield-construction-simulator":"";
const absoluteAsset=(path:string)=>new URL(`${siteBasePath}${path}`,siteOrigin).toString();
const title="终末地 · 工业规划台",description="轻量的明日方舟：终末地基地布局与生产模拟工具。";

export const metadata:Metadata={
  metadataBase:new URL(`${siteOrigin}${siteBasePath}/`),title,description,
  icons:{icon:absoluteAsset("/favicon.svg"),shortcut:absoluteAsset("/favicon.svg")},
  openGraph:{title,description,type:"website",images:[{url:absoluteAsset("/og.png"),width:1536,height:1024,alt:"终末地工业规划台蓝图与产销统计预览"}]},
  twitter:{card:"summary_large_image",title,description,images:[absoluteAsset("/og.png")]},
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
