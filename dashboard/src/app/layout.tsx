import type { Metadata } from "next";
import { Inter, Libre_Caslon_Display } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: '--font-inter' });
const caslon = Libre_Caslon_Display({ subsets: ["latin"], weight: ["400"], variable: '--font-caslon' });

export const metadata: Metadata = {
  title: "Jovi Dashboard | AI Command Center",
  description: "Supreme control dashboard for Jovi AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${caslon.variable} font-sans`}>{children}</body>
    </html>
  );
}
