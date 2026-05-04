import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isSupportedExamCode } from "@/lib/exams";
import { buildMockPlan } from "@/lib/mock/plan";
import { startMockAttempt } from "@/lib/mock/persistence";

/**
 * POST /api/mock/start
 *
 * Body: { examCode: "ege_en" | "oge_en" }
 *
 * Creates a fresh `mock_full` attempt, builds a randomised plan from the
 * existing item bank, persists the plan to `attempt.plan`, and returns
 * both. Persisting matters: clearing localStorage mid-mock and refreshing
 * needs to recover the *exact same* items the student already answered,
 * otherwise saved answers get orphaned and the results page double-counts
 * the difference.
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
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const examCode = (body as { examCode?: unknown })?.examCode;
  if (typeof examCode !== "string" || !isSupportedExamCode(examCode)) {
    return NextResponse.json(
      { error: "examCode must be 'ege_en' or 'oge_en'" },
      { status: 400 },
    );
  }

  const plan = await buildMockPlan(examCode);
  if (plan.sections.length === 0) {
    return NextResponse.json(
      {
        error:
          "No items available for this exam. Run pnpm db:seed:listening / db:seed:reading / db:seed:grammar first.",
      },
      { status: 503 },
    );
  }

  const attempt = await startMockAttempt({
    userId: session.user.id,
    examCode,
    plan,
  });

  return NextResponse.json({
    attemptId: attempt.id,
    startedAt: attempt.startedAt.toISOString(),
    plan,
  });
}
