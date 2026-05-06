"use client";

import * as React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A single FIPI criterion (e.g. К1 — Решение коммуникативной задачи).
 */
export type Criterion = {
  /** Short label such as `К1`. */
  code: string;
  /** Human-readable label, e.g. "Решение коммуникативной задачи". */
  label: string;
  /** Awarded score (integer). */
  score: number;
  /** Maximum possible score for this criterion. */
  max: number;
  /** Optional short comment / reason for the score. */
  comment?: string;
};

type ScoreCardProps = {
  title?: string;
  description?: string;
  criteria: Criterion[];
  className?: string;
};

/**
 * Displays a FIPI-style scoring table with per-criterion progress bars and
 * the aggregate total. Pure presentational — callers pass in already-parsed
 * criterion scores.
 */
export function ScoreCard({
  title = "FIPI Scoring",
  description,
  criteria,
  className,
}: ScoreCardProps) {
  const total = criteria.reduce((sum, c) => sum + c.score, 0);
  const max = criteria.reduce((sum, c) => sum + c.max, 0);
  const pct = max > 0 ? Math.round((total / max) * 100) : 0;

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <div className="flex items-baseline justify-between">
          <CardTitle>{title}</CardTitle>
          <span className="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
            {total}/{max} · {pct}%
          </span>
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        {criteria.map((c) => {
          const p = c.max > 0 ? Math.round((c.score / c.max) * 100) : 0;
          return (
            <div key={c.code} className="space-y-1">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">
                  {c.code} — {c.label}
                </span>
                <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                  {c.score}/{c.max}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className={cn(
                    "h-full transition-all",
                    p >= 80
                      ? "bg-green-600"
                      : p >= 50
                        ? "bg-amber-500"
                        : "bg-red-500",
                  )}
                  style={{ width: `${p}%` }}
                />
              </div>
              {c.comment && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {c.comment}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
