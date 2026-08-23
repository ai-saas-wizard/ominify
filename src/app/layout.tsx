import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Inter, JetBrains_Mono } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Tabular/monospace numerals for operational surfaces (sequence metrics,
// timestamps, phone numbers). Exposed as a CSS variable so Tailwind's
// `font-mono` utility resolves to a real family — it previously pointed at an
// unloaded Geist variable and silently fell back to the sans stack.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Omnify",
  description: "Voice Agent Management Platform",
  icons: {
    icon: "/omnify-logo.png",
    apple: "/omnify-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={`${inter.className} ${jetbrainsMono.variable}`}>
          <NextTopLoader color="#047857" showSpinner={false} />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
