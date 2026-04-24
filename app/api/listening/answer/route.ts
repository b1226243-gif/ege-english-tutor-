import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { gradeAndPersistListeningAnswer } from "@/lib/listening/persistence";
import { ListeningStudentAnswerSchema } from "@/lib/listening/types";

const BodySchema = z.object({
  itemId: z.string().uuid(),
  response: ListeningStudentAnswerSchema,
});

/**
 * POST /api/listening/answer
 *
 * Auto-grades a single listening MC response, persists an `answer` row + a
 * matching `rubric_score` row, and returns {correct, expected, answerId}
 * for the instant-verdict banner. AI discussion is a separate streaming
 * endpoint (`/api/listening/explain`).
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
    const result = await gradeAndPersistListeningAnswer({
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
