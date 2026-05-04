/**
 * Helpers for turning the AI SDK's `streamText` result into an HTTP response
 * that remains **self-describing on error**.
 *
 * Problem we solve: `result.toTextStreamResponse()` silently swallows
 * error/abort parts from the full stream. When OpenAI rejects with e.g.
 * `insufficient_quota`, the HTTP response is still `200` with an empty
 * body — so the client sees `res.ok=true`, reads zero chunks, and shows
 * nothing. See test-report-pr3.md (assertion A6).
 *
 * `textStreamToResponseWithFallback` manually pumps `result.fullStream`:
 * it forwards `text-delta` parts to the client and, if the stream emits
 * an `error` part (or throws), appends a Markdown `⚠` line so the UI
 * renders something actionable instead of an empty panel.
 *
 * Kept separate from `streamText` itself so every tutor route (grammar,
 * reading, listening, …) can reuse it without duplicating the plumbing.
 */
import type { streamText } from "ai";

type StreamTextResult = ReturnType<typeof streamText>;

function formatFallback(error: unknown): string {
  // Drill into OpenAI's {error:{message,code}} envelope when present.
  const maybe =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const inner = maybe.error;
  const innerObj =
    inner && typeof inner === "object"
      ? (inner as Record<string, unknown>)
      : null;
  const code = innerObj?.code ?? maybe.code;
  const message = innerObj?.message ?? maybe.message;

  if (code === "insufficient_quota") {
    return [
      "",
      "",
      "> ⚠ Не удалось получить разбор: в аккаунте OpenAI закончился лимит API",
      "> (`insufficient_quota`). Пополните баланс в",
      "> https://platform.openai.com/settings/organization/billing/overview",
      "> и повторите попытку.",
    ].join("\n");
  }
  if (typeof message === "string" && message.length > 0) {
    return `\n\n> ⚠ Не удалось получить разбор: ${message}`;
  }
  return `\n\n> ⚠ Не удалось получить разбор: ${String(error ?? "неизвестная ошибка AI-сервиса")}`;
}

/**
 * Turn a `streamText` result into a Fetch `Response`. Emits `text/plain`
 * chunks. If the AI SDK emits an `error` part or throws mid-stream, the
 * response body ends with a Markdown `⚠` paragraph describing the issue.
 */
export function textStreamToResponseWithFallback(
  result: StreamTextResult,
  init?: ResponseInit,
): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let finishedCleanly = false;
      try {
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            controller.enqueue(encoder.encode(part.text));
          } else if (part.type === "error") {
            controller.enqueue(encoder.encode(formatFallback(part.error)));
            finishedCleanly = true;
            controller.close();
            return;
          } else if (part.type === "abort") {
            controller.enqueue(
              encoder.encode(
                "\n\n> ⚠ Разбор прерван. Попробуйте ещё раз.",
              ),
            );
            finishedCleanly = true;
            controller.close();
            return;
          }
        }
        finishedCleanly = true;
        controller.close();
      } catch (err) {
        if (!finishedCleanly) {
          try {
            controller.enqueue(encoder.encode(formatFallback(err)));
          } catch {
            // controller already closed
          }
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(body, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}
