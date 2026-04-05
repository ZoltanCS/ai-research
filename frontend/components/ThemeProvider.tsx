"use client";

import { useEffect } from "react";
import { useStore } from "@/store";

/**
 * Reads the persisted theme from the Zustand store and keeps
 * document.documentElement.classList in sync with it.
 *
 * Must be rendered inside the <body> so that hydration works correctly.
 * The blocking <script> in layout.tsx applies the initial class synchronously
 * to avoid a flash of the wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
    }
  }, [theme]);

  return <>{children}</>;
}
