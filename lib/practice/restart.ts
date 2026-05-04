import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { attempts } from "@/lib/db/schema";

/**
 * Mark every `in_progress` practice attempt the user has on this task
 * template as `completed` and stamp `completed_at`. This is what runs when
 * a student clicks "Начать новый круг" in any of the auto-graded practice
 * modules (Grammar / Reading / Listening / Speaking).
 *
 * After this returns, the next `getOrCreatePracticeAttempt` call will
 * insert a fresh attempt — answers from the previous round stay in the
 * DB as a historical record, and the lifetime "Всего" counter on the
 * page keeps aggregating across attempts (it joins all attempts for the
 * user × template, not just the in-progress one).
 *
 * Returns the number of attempts that were transitioned. Returns 0 if
 * the student clicks "Начать новый круг" without ever answering — this
 * is intentionally a no-op rather than an error.
 */
export async function completeCurrentPracticeAttempt(params: {
  userId: string;
  taskTemplateId: string;
}): Promise<{ completed: number }> {
  const updated = await db()
    .update(attempts)
    .set({ status: "completed", completedAt: sql`now()` })
    .where(
      and(
        eq(attempts.userId, params.userId),
        eq(attempts.taskTemplateId, params.taskTemplateId),
        eq(attempts.mode, "practice"),
        eq(attempts.status, "in_progress"),
      ),
    )
    .returning({ id: attempts.id });

  return { completed: updated.length };
}
