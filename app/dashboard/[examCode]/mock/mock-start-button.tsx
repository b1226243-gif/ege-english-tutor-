"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SupportedExamCode } from "@/lib/exams";
import type { MockPlan } from "@/lib/mock/types";

const PLAN_KEY_PREFIX = "mock-plan:";

export function MockStartButton({ examCode }: { examCode: SupportedExamCode }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onStart() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/mock/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ examCode }),
      });
      if (!res.ok) {
        const payload = await safeJson(res);
        throw new Error((payload?.error as string) || `Ошибка ${res.status}`);
      }
      const data = (await res.json()) as {
        attemptId: string;
        startedAt: string;
        plan: MockPlan;
      };
      // Persist plan + attempt metadata so the runner page survives a
      // page reload mid-mock without re-randomising the items.
      try {
        window.localStorage.setItem(
          `${PLAN_KEY_PREFIX}${data.attemptId}`,
          JSON.stringify({
            startedAt: data.startedAt,
            plan: data.plan,
          }),
        );
      } catch {
        // Quota/disabled localStorage — the runner page will fall back to
        // re-fetching but for PR #7 it just won't preserve plan order.
      }
      router.push(
        `/dashboard/${examCode}/mock/${encodeURIComponent(data.attemptId)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={onStart} disabled={pending}>
        <Play className="mr-2 h-4 w-4" /> Начать пробник
      </Button>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
