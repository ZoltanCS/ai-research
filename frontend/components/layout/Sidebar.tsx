"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Brain,
  MessageSquare,
  Search,
  FileText,
  Plus,
  Trash2,
} from "lucide-react";
import { useStore } from "@/store";
import {
  getConversations,
  deleteConversation,
  type Conversation,
} from "@/lib/api";

// ── Nav items ─────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { href: "/chat",      icon: MessageSquare, label: "Chat"      },
  { href: "/research",  icon: Search,        label: "Research"  },
  { href: "/documents", icon: FileText,      label: "Documents" },
] as const;

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const { clearChat } = useStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);

  // Refresh conversation list on every navigation
  useEffect(() => {
    getConversations().then(setConversations).catch(console.error);
  }, [pathname]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <aside className="flex flex-col w-64 flex-shrink-0 h-full bg-[#111111] border-r border-zinc-800/80">
      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-4 py-[13px] border-b border-zinc-800/80">
        <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
          <Brain size={15} className="text-white" />
        </div>
        <span className="font-semibold text-sm text-white tracking-tight">
          LocalMind
        </span>
      </div>

      {/* ── New chat ──────────────────────────────────────────────────────── */}
      <div className="px-3 pt-3">
        <Link
          href="/chat"
          onClick={clearChat}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
        >
          <Plus size={14} />
          <span>New chat</span>
        </Link>
      </div>

      {/* ── Navigation ────────────────────────────────────────────────────── */}
      <nav className="px-3 pt-1 space-y-0.5">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active =
            pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors ${
                active
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
              }`}
            >
              <Icon size={14} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Divider ───────────────────────────────────────────────────────── */}
      <div className="mx-3 my-3 border-t border-zinc-800/60" />

      {/* ── Recent conversations ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 space-y-0.5 min-h-0">
        {conversations.length > 0 && (
          <>
            <p className="px-3 pb-1.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
              Recent
            </p>
            {conversations.slice(0, 30).map((conv) => (
              <div key={conv.id} className="group relative">
                <Link
                  href={`/chat?id=${conv.id}`}
                  className="flex items-center px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-lg transition-colors"
                >
                  <span className="truncate pr-6">{conv.title}</span>
                </Link>
                <button
                  onClick={(e) => handleDelete(e, conv.id)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded"
                  title="Delete conversation"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-t border-zinc-800/60">
        <p className="text-[11px] text-zinc-700">LocalMind v0.1.0</p>
      </div>
    </aside>
  );
}

export default Sidebar;
