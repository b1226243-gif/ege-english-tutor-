import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { saveMockAnswer } from "@/lib/mock/persistence";
import { MockAnswerRequestSchema } from "@/lib/mock/types";

/**
 * POST /api/mock/answer
 *
 * Body: MockAnswerRequest (discriminated by `kind`).
 *
 * Saves a mock answer. Auto-grades server-side but does NOT reveal the
 * verdict to the client — mock-mode is "blind" until the attempt is
 * submitted, exactly like a real exam.
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
  const parsed = MockAnswerRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { answerId } = await saveMockAnswer({
      userId: session.user.id,
      request: parsed.data,
    });
    return NextResponse.json({ answerId, saved: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Save failed";
    const status =
      msg === "Forbidden"
        ? 403
        : msg.startsWith("Mock attempt")
          ? 410
          : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
