"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useStore } from "@/store";

const PUBLIC_PATHS = ["/login"];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const authToken = useStore((s) => s.authToken);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
    if (!authToken && !isPublic) {
      router.replace("/login");
    }
  }, [authToken, pathname, router]);

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // If not authenticated and not on a public page, render nothing while redirecting
  if (!authToken && !isPublic) {
    return null;
  }

  // If authenticated and on login page, redirect to chat
  if (authToken && pathname.startsWith("/login")) {
    router.replace("/chat");
    return null;
  }

  return <>{children}</>;
}
