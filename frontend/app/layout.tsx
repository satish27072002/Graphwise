import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "CodeGraph Navigator",
  description: "Understand any codebase instantly with Graph RAG",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark h-full ${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen flex flex-col bg-[#080808] text-[#f0f0f0] antialiased font-sans">
        {children}
        <Toaster theme="dark" position="bottom-right" />
      </body>
    </html>
  );
}
