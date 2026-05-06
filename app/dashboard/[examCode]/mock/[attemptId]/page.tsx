import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { EXAM_DISPLAY, isSupportedExamCode } from "@/lib/exams";
import { getMockAttempt } from "@/lib/mock/persistence";
import { MockRunner } from "./mock-runner";

/**
 * Mock-exam runner.
 *
 * Server-side: validates the attempt belongs to the user and is still
 * `in_progress`. The plan itself is hydrated client-side from
 * localStorage (set by `MockStartButton`). If localStorage is missing,
 * the runner re-fetches a fresh plan from the server (which may shuffle
 * items differently — acceptable for v1, the answers already saved are
 * preserved either way).
 */
export default async function MockRunnerPage({
  params,
}: {
  params: Promise<{ examCode: string; attemptId: string }>;
}) {
  const { examCode, attemptId } = await params;
  if (!isSupportedExamCode(examCode)) notFound();

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/sign-in?redirect=${encodeURIComponent(
      `/dashboard/${examCode}/mock/${attemptId}`,
    )}`);
  }

  const attempt = await getMockAttempt(attemptId);
  if (!attempt || attempt.userId !== session.user.id) notFound();
  if (attempt.examCode !== examCode) notFound();

  if (attempt.status !== "in_progress") {
    redirect(`/dashboard/${examCode}/mock/${attemptId}/results`);
  }

  const exam = EXAM_DISPLAY[examCode];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Link href="/dashboard" className="hover:underline">
          Экзамены
        </Link>
        <span>›</span>
        <Link href={`/dashboard/${examCode}`} className="hover:underline">
          {exam.shortName}
        </Link>
        <span>›</span>
        <Link
          href={`/dashboard/${examCode}/mock`}
          className="hover:underline"
        >
          Mock-экзамен
        </Link>
        <span>›</span>
        <span>Сессия</span>
      </div>
      <MockRunner
        examCode={examCode}
        attemptId={attemptId}
        startedAtIso={attempt.startedAt.toISOString()}
      />
    </div>
  );
}
