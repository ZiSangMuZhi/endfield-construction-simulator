import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata():Promise<Metadata> {
  const requestHeaders=await headers();
  const host=requestHeaders.get("x-forwarded-host")??requestHeaders.get("host")??"endfield-construction-planner.zisangmuzhi.chatgpt.site";
  const protocol=requestHeaders.get("x-forwarded-proto")??(host.startsWith("localhost")?"http":"https");
  const previewUrl=new URL("/og.png",`${protocol}://${host}`).toString();
  const title="终末地 · 工业规划台",description="轻量的明日方舟：终末地基地布局与生产模拟工具。";
  return {title,description,icons:{icon:"/favicon.svg",shortcut:"/favicon.svg"},openGraph:{title,description,type:"website",images:[{url:previewUrl,width:1536,height:1024,alt:"终末地工业规划台蓝图与产销统计预览"}]},twitter:{card:"summary_large_image",title,description,images:[previewUrl]}};
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
