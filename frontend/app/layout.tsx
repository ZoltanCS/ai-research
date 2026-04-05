import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import TopBar from "@/components/TopBar";

export const metadata: Metadata = {
  title: "LocalMind",
  description: "Local AI research and chat application",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className="font-sans bg-background text-foreground antialiased"
      >
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex flex-1 flex-col min-w-0">
            <TopBar />
            <main className="flex-1 overflow-hidden">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
