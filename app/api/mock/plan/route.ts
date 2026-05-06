import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isSupportedExamCode } from "@/lib/exams";
import { buildMockPlan } from "@/lib/mock/plan";
import { getMockAttempt } from "@/lib/mock/persistence";

/**
 * GET /api/mock/plan?attemptId=...
 *
 * Recovers the *exact* plan that was frozen at mock start, so a student
 * who clears localStorage (private window, different device, cleared
 * cache) sees the same items they were already answering. Without this,
 * a fresh re-randomisation would orphan saved answers and the results
 * page would double-count the difference.
 *
 * Crucially this endpoint NEVER creates a new attempt; that's what
 * `/api/mock/start` is for.
 *
 * Falls back to a fresh build only for legacy attempts created before
 * the `attempt.plan` column existed — those rows have no other recovery
 * option and the data loss was already implicit when they were created.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const attemptId = url.searchParams.get("attemptId");
  if (!attemptId) {
    return NextResponse.json(
      { error: "attemptId query param is required" },
      { status: 400 },
    );
  }

  const attempt = await getMockAttempt(attemptId);
  if (!attempt || attempt.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isSupportedExamCode(attempt.examCode)) {
    return NextResponse.json(
      { error: "Attempt has unsupported examCode" },
      { status: 400 },
    );
  }

  const plan =
    attempt.plan ?? (await buildMockPlan(attempt.examCode));
  if (plan.sections.length === 0) {
    return NextResponse.json(
      { error: "No items available for this exam." },
      { status: 503 },
    );
  }

  return NextResponse.json({
    attemptId,
    startedAt: attempt.startedAt.toISOString(),
    plan,
  });
}
