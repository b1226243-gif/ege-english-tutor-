import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { completeCurrentPracticeAttempt } from "@/lib/practice/restart";

const BodySchema = z.object({
  taskTemplateId: z.string().uuid(),
});

/**
 * POST /api/practice/restart
 *
 * Closes the user's current in-progress practice attempt for a given task
 * template (Grammar / Reading / Listening / Speaking). The next answer the
 * student submits will start a brand-new attempt, so "Начать новый круг"
 * actually means "start a new run" rather than overwriting the previous
 * one in place.
 *
 * Idempotent: if there is no in-progress attempt, returns 200 with
 * `{ completed: 0 }`.
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
    const result = await completeCurrentPracticeAttempt({
      userId: session.user.id,
      taskTemplateId: parsed.data.taskTemplateId,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
