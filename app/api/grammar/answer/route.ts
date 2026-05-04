import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { gradeAndPersistAnswer } from "@/lib/grammar/persistence";
import { GrammarStudentAnswerSchema } from "@/lib/grammar/types";

const BodySchema = z.object({
  itemId: z.string().uuid(),
  response: GrammarStudentAnswerSchema,
});

/**
 * POST /api/grammar/answer
 *
 * Auto-grades a student's response to a single grammar item, persists an
 * `answer` row (+ matching `rubric_score`), and returns a small payload
 * the UI uses to render the instant check banner. AI-generated explanation
 * is a separate stream (see `/api/grammar/explain`).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await gradeAndPersistAnswer({
      userId: session.user.id,
      itemId: parsed.data.itemId,
      response: parsed.data.response,
    });
    return NextResponse.json({
      correct: result.correct,
      expected: result.expected,
      answerId: result.answerId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
