"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Brain } from "lucide-react";
import { toast } from "sonner";
import { login, register } from "@/lib/api";
import { useStore } from "@/store";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { setAuth } = useStore();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = mode === "login"
        ? await login(username, password)
        : await register(username, email, password);
      setAuth(res.access_token, res.user);
      router.push("/chat");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center ring-1 ring-zinc-700">
            <Brain size={22} className="text-zinc-300" />
          </div>
          <h1 className="text-xl font-semibold text-zinc-100">LocalMind</h1>
          <p className="text-sm text-zinc-500">
            {mode === "login" ? "Sign in to your account" : "Create your account"}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600 transition-colors"
              placeholder="your_username"
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600 transition-colors"
                placeholder="you@example.com"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600 transition-colors"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm font-medium rounded-xl transition-colors mt-1"
          >
            {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        {/* Toggle */}
        <p className="text-center text-xs text-zinc-600 mt-5">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="text-zinc-400 hover:text-zinc-200 underline transition-colors"
          >
            {mode === "login" ? "Register" : "Sign in"}
          </button>
        </p>

        {mode === "register" && (
          <p className="text-center text-xs text-zinc-700 mt-3">
            The first account registered becomes the admin.
          </p>
        )}
      </div>
    </div>
  );
}
