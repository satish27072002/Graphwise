import type { Metadata } from "next";
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
    <html lang="en" className="dark">
      <body>
        {children}
        <Toaster theme="dark" position="bottom-right" />
      </body>
    </html>
  );
}
