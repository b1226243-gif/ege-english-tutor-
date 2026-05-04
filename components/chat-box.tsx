"use client";

import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Send, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { TutorModule } from "@/lib/prompts";

type ChatBoxProps = {
  /** Which tutor brain to use — changes the system prompt server-side. */
  module?: TutorModule;
  /** Placeholder for the input. */
  placeholder?: string;
  /** Optional pre-seeded messages (e.g. a task stimulus from the server). */
  initialMessages?: UIMessage[];
  /**
   * When set, the ChatBox fires a one-off `sendMessage` with this text on
   * mount (and on subsequent prop changes). Combined with a `key` on the
   * parent that bumps per submission, this lets parents like Writing /
   * Speaking trigger an evaluation without the student having to type in
   * the follow-up box.
   */
  autoSubmit?: string;
  /** Additional classes on the outer wrapper. */
  className?: string;
  /** When true, render the assistant messages as a single feedback pane
   *  (latest reply wins), instead of a scrolling chat transcript. */
  variant?: "chat" | "feedback";
};

export function ChatBox({
  module = "base",
  placeholder = "Ask your tutor anything…",
  initialMessages,
  autoSubmit,
  className,
  variant = "chat",
}: ChatBoxProps) {
  const [input, setInput] = React.useState("");
  const { messages, sendMessage, status, error } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { module },
    }),
  });

  const isBusy = status === "submitted" || status === "streaming";

  // Fire the initial evaluation request when the parent seeds `autoSubmit`.
  // Guarded by a ref so StrictMode double-invokes don't POST twice.
  const didAutoSubmit = React.useRef(false);
  React.useEffect(() => {
    const trimmed = autoSubmit?.trim();
    if (!trimmed || didAutoSubmit.current) return;
    didAutoSubmit.current = true;
    sendMessage({ text: trimmed });
  }, [autoSubmit, sendMessage]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isBusy) return;
    sendMessage({ text: trimmed });
    setInput("");
  };

  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const latestAssistant = assistantMessages[assistantMessages.length - 1];

  return (
    <div
      className={cn(
        "flex h-full flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950",
        className,
      )}
    >
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
        {variant === "chat"
          ? messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))
          : latestAssistant && <MessageBubble message={latestAssistant} bare />}
        {variant === "chat" && messages.length === 0 && (
          <p className="text-sm text-zinc-500">
            No messages yet. Your tutor will respond per FIPI 2024/25 criteria.
          </p>
        )}
        {variant === "feedback" && !latestAssistant && (
          <p className="text-sm text-zinc-500">
            Submit your work on the left to receive FIPI-aligned feedback here.
          </p>
        )}
        {error && <ErrorBanner error={error} />}
      </div>

      <form onSubmit={onSubmit} className="flex gap-2 items-end">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          className="min-h-[52px] max-h-[200px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              onSubmit(e);
            }
          }}
        />
        <Button type="submit" disabled={isBusy || !input.trim()} size="icon">
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
}

/**
 * Upstream errors (OpenAI 429/5xx, Auth.js 401, Zod 400) arrive here either
 * as a plain `Error` with JSON text in `.message` or as a thrown stream
 * event. We parse the common shapes and render a friendly banner with a
 * concrete next step, instead of dumping raw JSON at the student.
 */
function ErrorBanner({ error }: { error: Error }) {
  const parsed = parseError(error);
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
      <div className="font-medium">{parsed.title}</div>
      {parsed.hint && (
        <div className="mt-1 text-xs text-red-800/80 dark:text-red-300/80">
          {parsed.hint}
        </div>
      )}
    </div>
  );
}

function parseError(error: Error): { title: string; hint?: string } {
  const raw = error.message || "";
  // The AI SDK often surfaces JSON strings — try to parse them.
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    // keep raw
  }

  const looksLikeQuota =
    /quota|rate[_ ]?limit|insufficient_quota/i.test(raw);
  const looksLikeAuth = /unauthori[sz]ed|401/i.test(raw);
  const looksLikeMissingKey = /OPENAI_API_KEY|not configured/i.test(raw);

  if (looksLikeMissingKey) {
    return {
      title: "OPENAI_API_KEY не настроен",
      hint:
        "Добавьте ключ в .env.local (см. .env.example) и перезапустите сервер.",
    };
  }
  if (looksLikeQuota) {
    return {
      title: "Лимит OpenAI исчерпан",
      hint:
        "Пополните баланс OpenAI: https://platform.openai.com/settings/organization/billing/overview",
    };
  }
  if (looksLikeAuth) {
    return {
      title: "Сессия истекла",
      hint: "Обновите страницу и войдите снова.",
    };
  }

  if (payload && typeof payload === "object") {
    const p = payload as { error?: unknown };
    const err = p.error;
    if (typeof err === "string") return { title: err };
    if (err && typeof err === "object") {
      const e = err as { message?: unknown };
      if (typeof e.message === "string") return { title: e.message };
    }
  }
  return {
    title: raw || "Что-то пошло не так. Попробуйте ещё раз.",
  };
}

function MessageBubble({
  message,
  bare = false,
}: {
  message: UIMessage;
  bare?: boolean;
}) {
  const text = message.parts
    .filter((p): p is Extract<UIMessage["parts"][number], { type: "text" }> =>
      p.type === "text",
    )
    .map((p) => p.text)
    .join("");

  if (bare) {
    return (
      <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap">
        {text}
      </div>
    );
  }

  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
          isUser
            ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50",
        )}
      >
        {text}
      </div>
    </div>
  );
}
