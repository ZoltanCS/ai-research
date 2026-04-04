"use client";

import { useState } from "react";
import { Search, ExternalLink, Loader2 } from "lucide-react";
import { webSearch, type SearchResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ResearchPanel() {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);
    setResults(null);

    try {
      const data = await webSearch(query.trim(), 8);
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full p-6 max-w-3xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">Web Research</h1>
        <p className="text-muted-foreground text-sm">
          Search the web using Tavily AI-powered search. Requires{" "}
          <code className="bg-muted px-1 rounded text-xs">TAVILY_API_KEY</code>.
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the web…"
          className={cn(
            "flex-1 rounded-lg border bg-background px-4 py-2.5 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring"
          )}
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={!query.trim() || isLoading}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors",
            query.trim() && !isLoading
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Search
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      {results && (
        <div className="space-y-4 overflow-y-auto">
          {/* AI Summary */}
          {results.answer && (
            <div className="rounded-lg border bg-muted/50 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                AI Summary
              </p>
              <p className="text-sm leading-relaxed">{results.answer}</p>
            </div>
          )}

          {/* Results */}
          <p className="text-xs text-muted-foreground">
            {results.results.length} results for "{results.query}"
          </p>

          {results.results.map((result, i) => (
            <article
              key={i}
              className="rounded-lg border p-4 hover:bg-muted/30 transition-colors"
            >
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group"
              >
                <h3 className="font-medium text-sm mb-1 group-hover:text-primary flex items-start gap-1.5">
                  {result.title}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 mt-0.5 opacity-50 group-hover:opacity-100" />
                </h3>
                <p className="text-xs text-primary/70 mb-2 truncate">{result.url}</p>
              </a>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                {result.content}
              </p>
            </article>
          ))}
        </div>
      )}

      {!results && !isLoading && !error && (
        <div className="flex-1 flex items-center justify-center text-center">
          <div>
            <Search className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">
              Enter a query to search the web
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
