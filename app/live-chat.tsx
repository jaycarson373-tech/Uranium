"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type ChatMessage = {
  id: number;
  name: string;
  message: string;
  created_at: string;
};

const POLL_INTERVAL_MS = 4_000;

function messageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function LiveChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"loading" | "live" | "offline">("loading");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const response = await fetch("/api/chat", { cache: "no-store" });
      if (!response.ok) throw new Error("Chat unavailable");
      const body = await response.json() as { messages?: ChatMessage[] };
      setMessages(Array.isArray(body.messages) ? body.messages : []);
      setStatus("live");
    } catch {
      setStatus("offline");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadMessages(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadMessages();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [loadMessages]);

  useEffect(() => {
    if (status !== "live") return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanMessage = draft.trim();
    if (!cleanName || !cleanMessage || sending) return;

    setSending(true);
    setNotice("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: cleanName, message: cleanMessage }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Message was not sent");
      window.localStorage.setItem("usr-chat-name", cleanName);
      setDraft("");
      setStatus("live");
      await loadMessages();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Message was not sent");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="chat-section" id="community-chat" aria-labelledby="chat-title">
      <div className="chat-copy">
        <span>Community frequency / public</span>
        <h2 id="chat-title">Live strategy chat.</h2>
        <p>Share rig strategies and beta feedback. Never post seed phrases, private keys or wallet recovery information.</p>
        <div className={`chat-live-state ${status}`}>
          <i />
          {status === "live" ? "Live · updates every 4 seconds" : status === "loading" ? "Connecting" : "Chat setup required"}
        </div>
      </div>

      <div className="chat-terminal">
        <div className="chat-log" ref={listRef} aria-live="polite" aria-label="Community messages">
          {messages.length > 0 ? messages.map((item) => (
            <article key={item.id}>
              <header><strong>{item.name}</strong><time dateTime={item.created_at}>{messageTime(item.created_at)}</time></header>
              <p>{item.message}</p>
            </article>
          )) : (
            <div className="chat-empty">
              {status === "offline"
                ? "Connect the Supabase chat environment to open this channel."
                : "No messages yet. Start the strategy desk."}
            </div>
          )}
        </div>

        <form className="chat-form" onSubmit={submit}>
          <label>
            Display name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={24}
              autoComplete="nickname"
              placeholder="Miner name"
              required
            />
          </label>
          <label className="chat-message-field">
            Message
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={280}
              placeholder="Share a strategy…"
              required
            />
          </label>
          <button type="submit" disabled={sending || status === "offline"}>
            {sending ? "Sending" : "Transmit"}
          </button>
        </form>
        {notice && <p className="chat-notice" role="alert">{notice}</p>}
      </div>
    </section>
  );
}
