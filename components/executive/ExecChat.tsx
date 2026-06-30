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
    <section className="exec-section">
      <div className="exec-section-head">
        <h2 className="exec-section-title">
          <span className="icon" aria-hidden>💬</span>
          Exec Chat
        </h2>
        <span className="exec-pill-ai">✦ Ask anything</span>
      </div>

      <div className={cn(showLibrary ? "grid gap-0 lg:grid-cols-[1fr_280px]" : "")}>
        <div>
          <div ref={scrollRef} className="exec-chat-box max-h-[420px] overflow-y-auto" style={{ paddingTop: 18 }}>
            {messages.length === 0 && (
              <div className="exec-chat-msg">
                <div className="exec-chat-avatar ai">Q</div>
                <div className="exec-chat-bubble">
                  Ask about pipeline volume, stalled deals, team performance, or refi opportunities — answers are grounded in live data.
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn("exec-chat-msg", m.role === "user" && "user")}>
                <div className={cn("exec-chat-avatar", m.role === "user" ? "usr" : "ai")}>
                  {m.role === "user" ? "You" : "Q"}
                </div>
                <div className="exec-chat-bubble whitespace-pre-wrap">
                  <div>{m.content}</div>
                  {m.toolTrace && m.toolTrace.length > 0 && (
                    <div className="pt-1 text-[10px] opacity-70">
                      tools: {m.toolTrace.map((t) => `${t.name}(${t.ms}ms)${t.ok ? "" : "✗"}`).join(", ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="exec-chat-msg">
                <div className="exec-chat-avatar ai">Q</div>
                <div className="exec-chat-bubble">Thinking…</div>
              </div>
            )}
          </div>
          <form onSubmit={handleSubmit} className="exec-chat-input-row">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about pipeline, teams, or revenue…"
              disabled={loading}
              className="exec-chat-input"
            />
            <button type="submit" disabled={loading || !input.trim()} className="exec-chat-send">
              ↗
            </button>
          </form>
        </div>

        {showLibrary && (
          <aside className="border-l border-[var(--border-soft)] p-3">
            <button
              type="button"
              onClick={() => setShowLibrary(false)}
              className="mb-2 text-xs text-[var(--ink-500)] hover:text-[var(--ink-900)]"
            >
              Hide examples
            </button>
            <div className="max-h-[400px] overflow-y-auto space-y-1">
              {visiblePrompts.slice(0, 12).map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => void send(p.text)}
                  className="block w-full rounded-md px-2 py-2 text-left text-xs hover:bg-[var(--cream-100)]"
                >
                  {p.text}
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>

      {!showLibrary && (
        <div className="px-5 pb-3">
          <button
            type="button"
            onClick={() => setShowLibrary(true)}
            className="text-xs text-[var(--ink-500)] hover:text-[var(--ink-900)]"
          >
            Show example prompts ({PROMPT_LIBRARY.length})
          </button>
        </div>
      )}
    </section>
  );
}
