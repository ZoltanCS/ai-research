import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import TopBar from "@/components/TopBar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "sonner";

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
    // suppressHydrationWarning lets the blocking script set the class without
    // React complaining about a server/client mismatch.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking script: apply saved theme before first paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=JSON.parse(localStorage.getItem('localmind-store')||'{}');if((s.state||s).theme!=='light')document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans bg-background text-foreground antialiased">
        <ThemeProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <div className="flex flex-1 flex-col min-w-0">
              <TopBar />
              <main className="flex-1 overflow-hidden">{children}</main>
            </div>
          </div>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "#1c1c1c",
                border: "1px solid #2a2a2a",
                color: "#e4e4e7",
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
