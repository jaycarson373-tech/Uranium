import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const image = new URL("/og.png", base).toString();

  return {
    metadataBase: base,
    title: "Uranium Strategy — The On-Chain Uranium Empire",
    description: "Build, mine, and compound across a cinematic on-chain uranium reserve.",
    icons: { icon: "/favicon.svg" },
    openGraph: {
      title: "Uranium Strategy",
      description: "The on-chain uranium empire. Build · Mine · Compound.",
      type: "website",
      images: [{ url: image, width: 1536, height: 1024, alt: "Uranium Strategy" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Uranium Strategy",
      description: "The on-chain uranium empire. Build · Mine · Compound.",
      images: [image],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
