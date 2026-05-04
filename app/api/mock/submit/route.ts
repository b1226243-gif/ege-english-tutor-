import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { submitMockAttempt } from "@/lib/mock/persistence";

/**
 * POST /api/mock/submit
 *
 * Body: { attemptId: string }
 *
 * Marks a mock attempt as completed and returns the full breakdown
 * (per-section scores + per-item verdicts) to render the results page.
 * Idempotent — calling twice returns the same payload but does not
 * change the attempt's `completedAt`.
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
  const attemptId = (body as { attemptId?: unknown })?.attemptId;
  if (typeof attemptId !== "string") {
    return NextResponse.json(
      { error: "attemptId must be a string" },
      { status: 400 },
    );
  }

  try {
    const results = await submitMockAttempt({
      userId: session.user.id,
      attemptId,
    });
    return NextResponse.json(results);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Submit failed";
    const status = msg === "Forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
