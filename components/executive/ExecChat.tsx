"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import {
  DEPTH_LABEL,
  DEPTH_TONE,
  PROMPT_CATEGORIES,
  PROMPT_LIBRARY,
  type PromptCategory,
  type PromptDepth,
} from "@/lib/ai/prompt-library";

type Message = {
  role: "user" | "assistant";
  content: string;
  toolTrace?: { name: string; ok: boolean; ms: number }[];
};

export function ExecChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [filterCategory, setFilterCategory] = useState<PromptCategory | null>(null);
  const [filterDepth, setFilterDepth] = useState<PromptDepth | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const visiblePrompts = useMemo(() => {
    return PROMPT_LIBRARY.filter(
      (p) =>
        (!filterCategory || p.category === filterCategory) &&
        (!filterDepth || p.depth === filterDepth),
    );
  }, [filterCategory, filterDepth]);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  async function send(textFromCta?: string) {
    const text = (textFromCta ?? input).trim();
    if (!text || loading) return;
    const userMsg: Message = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    scrollToBottom();

    try {
      const res = await fetch("/api/executive/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setMessages([...next, { role: "assistant", content: err.error ?? "Something went wrong." }]);
        return;
      }
      const data = await res.json();
      setMessages([
        ...next,
        {
          role: "assistant",
          content: data.message?.content ?? "(no response)",
          toolTrace: data.toolTrace,
        },
      ]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Network error. Please try again." }]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-mutedForeground">
            AI Chat Interface — Executive Command Center
          </div>
          <h2 className="mt-0.5 text-lg font-semibold">Ask the pipeline</h2>
          <p className="text-xs text-mutedForeground">
            Grounded on live loans + deal signals. Every answer is backed by a tool call — no
            hallucinations.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowLibrary((v) => !v)}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
        >
          {showLibrary ? "Hide examples" : "Show examples"} ({PROMPT_LIBRARY.length})
        </button>
      </div>

      <div className={cn("grid gap-4", showLibrary ? "lg:grid-cols-[1fr_320px]" : "grid-cols-1")}>
        {/* Chat */}
        <div className="lo-card flex h-[520px] flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <div className="max-w-md text-center">
                  <p className="text-sm text-mutedForeground">Try asking:</p>
                  <div className="mt-3 space-y-2">
                    {[
                      "What are the top deals we should go after today? Call findDealCandidates and listSignals with no LO filter. Lead every bullet with borrower name and LO, then loan_id.",
                      "Which LO has the most stalled deals right now?",
                      "Show me deals that were Clear to Close but didn't fund this quarter.",
                    ].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => void send(t)}
                        className="block w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] space-y-1 rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                    m.role === "user" ? "bg-primary text-primaryForeground" : "bg-muted text-foreground",
                  )}
                >
                  <div>{m.content}</div>
                  {m.toolTrace && m.toolTrace.length > 0 && (
                    <div className="pt-1 text-[10px] text-mutedForeground">
                      tools: {m.toolTrace.map((t) => `${t.name}(${t.ms}ms)${t.ok ? "" : "✗"}`).join(", ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-muted px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-mutedForeground [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-mutedForeground [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-mutedForeground [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
          </div>
          <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border p-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about LOs, stalls, refi candidates, pipeline volume…"
              disabled={loading}
              className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none placeholder:text-mutedForeground focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primaryForeground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>

        {/* Suggested prompts sidebar */}
        {showLibrary && (
          <aside className="lo-card overflow-hidden">
            <div className="space-y-3 p-3">
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-mutedForeground">
                  Category
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setFilterCategory(null)}
                    className={cn(
                      "rounded-full border border-border px-2 py-0.5 text-[11px]",
                      !filterCategory && "bg-foreground text-background",
                    )}
                  >
                    All
                  </button>
                  {PROMPT_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setFilterCategory(c)}
                      className={cn(
                        "rounded-full border border-border px-2 py-0.5 text-[11px]",
                        filterCategory === c && "bg-foreground text-background",
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-mutedForeground">
                  Depth
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setFilterDepth(null)}
                    className={cn(
                      "rounded-full border border-border px-2 py-0.5 text-[11px]",
                      !filterDepth && "bg-foreground text-background",
                    )}
                  >
                    All
                  </button>
                  {(["quick", "analysis", "report"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setFilterDepth(d)}
                      className={cn(
                        "rounded-full border border-border px-2 py-0.5 text-[11px]",
                        filterDepth === d && "bg-foreground text-background",
                      )}
                    >
                      {DEPTH_LABEL[d]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="max-h-[420px] overflow-y-auto border-t border-border p-2">
              {visiblePrompts.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => void send(p.text)}
                  className="block w-full rounded-md px-2 py-2 text-left text-xs hover:bg-muted"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-mutedForeground">
                      {p.category}
                    </span>
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-0 text-[9px] uppercase tracking-wider",
                        DEPTH_TONE[p.depth],
                      )}
                    >
                      {DEPTH_LABEL[p.depth]}
                    </span>
                  </div>
                  <div className="mt-1">{p.text}</div>
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
