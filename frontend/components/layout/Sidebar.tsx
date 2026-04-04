"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageSquare,
  Search,
  FileText,
  Plus,
  Trash2,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getConversations, deleteConversation, type Conversation } from "@/lib/api";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    getConversations()
      .then(setConversations)
      .catch(() => {});
  }, [pathname]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    await deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (pathname.includes(id)) router.push("/chat");
  };

  const navItems = [
    { href: "/chat", icon: MessageSquare, label: "Chat" },
    { href: "/research", icon: Search, label: "Research" },
  ];

  return (
    <aside className="w-64 border-r bg-muted/30 flex flex-col h-screen">
      {/* Logo */}
      <div className="p-4 border-b flex items-center gap-2">
        <Brain className="h-6 w-6 text-primary" />
        <span className="font-semibold text-lg">LocalMind</span>
      </div>

      {/* Navigation */}
      <nav className="p-2 space-y-1">
        {navItems.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              pathname.startsWith(href)
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="px-2 mt-2">
        <Link
          href="/chat"
          className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm border border-dashed text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
        >
          <Plus className="h-4 w-4" />
          New conversation
        </Link>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto px-2 mt-4">
        <p className="px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Recent
        </p>
        <div className="space-y-0.5">
          {conversations.map((conv) => (
            <Link
              key={conv.id}
              href={`/chat?id=${conv.id}`}
              className={cn(
                "group flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                pathname.includes(conv.id)
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 truncate">{conv.title}</span>
              <button
                onClick={(e) => handleDelete(e, conv.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-destructive transition-all"
                aria-label="Delete conversation"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </Link>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t">
        <p className="text-xs text-muted-foreground text-center">
          LocalMind v0.1.0
        </p>
      </div>
    </aside>
  );
}
