import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { getSystemPrompt, type TutorModule } from "@/lib/prompts";

// Stream responses for up to 60s (Next.js 16 / Vercel AI SDK default cap).
export const maxDuration = 60;

const BodySchema = z.object({
  messages: z.array(z.unknown()),
  module: z
    .enum(["base", "writing-37", "writing-38", "speaking"])
    .optional()
    .default("base"),
});

/**
 * POST /api/chat
 *
 * Streams a response from the configured LLM (GPT-4o by default) using the
 * Vercel AI SDK. The system prompt is resolved from `getSystemPrompt(module)`
 * so the same endpoint serves Writing, Speaking, and the generic tutor.
 *
 * Auth: requires a logged-in user. Returns 401 otherwise.
 * Env:  OPENAI_API_KEY (required). If missing, we return a 503 with a
 *       human-readable hint rather than letting the SDK throw.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is not configured. Set it in .env.local (see .env.example).",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { messages, module } = parsed.data;
  const system = getSystemPrompt(module as TutorModule);

  const result = streamText({
    model: openai(process.env.OPENAI_MODEL ?? "gpt-4o"),
    system,
    messages: await convertToModelMessages(messages as UIMessage[]),
    temperature: 0.4,
  });

  return result.toUIMessageStreamResponse();
}
