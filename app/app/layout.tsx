import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Var är sjuttan bussen?",
  description: "Realtidskarta för Västtrafik i Göteborg",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sv" className="h-full antialiased">
      <body className="h-full flex flex-col">{children}</body>
    </html>
  );
}
