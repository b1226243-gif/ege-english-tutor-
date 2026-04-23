"use client";

import * as React from "react";

import { ChatBox } from "@/components/chat-box";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { TutorModule } from "@/lib/prompts";

/**
 * Writing module — split-screen layout.
 *
 * Left pane  : task selector (37 / 38) + textarea for the student's essay
 *              + word-count + submit button.
 * Right pane : AI feedback (ChatBox in `feedback` variant, so only the
 *              latest assistant reply is shown, formatted as Markdown-ish
 *              text).
 *
 * Submission simply injects the student's text as a new chat message; the
 * server-side system prompt (per module) does the FIPI-aligned evaluation.
 */
export default function WritingPage() {
  const [task, setTask] = React.useState<"writing-37" | "writing-38">(
    "writing-37",
  );
  const [essay, setEssay] = React.useState("");
  const [submittedAt, setSubmittedAt] = React.useState(0);

  // Re-mount ChatBox when the student submits a new draft so we always start
  // from a clean transcript per submission.
  const chatKey = `${task}-${submittedAt}`;

  const wordCount = React.useMemo(
    () => essay.trim().split(/\s+/).filter(Boolean).length,
    [essay],
  );

  const limits = task === "writing-37"
    ? { min: 100, max: 140, hardMin: 90 }
    : { min: 180, max: 275, hardMin: 160 };

  const initialMessages = React.useMemo(() => {
    if (submittedAt === 0) return undefined;
    return [
      {
        id: `draft-${submittedAt}`,
        role: "user" as const,
        parts: [
          {
            type: "text" as const,
            text: `Please evaluate the following ${
              task === "writing-37" ? "Task 37 (personal email)" : "Task 38 (opinion essay)"
            } strictly according to FIPI 2024/25 criteria.\n\n---\n${essay}\n---\n\nWord count (student-side estimate): ${wordCount}.`,
          },
        ],
      },
    ];
  }, [submittedAt, task, essay, wordCount]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight mr-auto">
          Writing
        </h1>
        <TaskToggle value={task} onChange={setTask} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 min-h-[70vh]">
        {/* LEFT: student input */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>
              {task === "writing-37"
                ? "Task 37 — Personal email (100–140 words)"
                : "Task 38 — Opinion essay on a chart/table (180–275 words)"}
            </CardTitle>
            <CardDescription>
              {task === "writing-37"
                ? "Write a friendly email answering all the questions from the stimulus."
                : "Write a five-paragraph opinion essay based on the chart/table stimulus."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-3">
            <Textarea
              value={essay}
              onChange={(e) => setEssay(e.target.value)}
              placeholder="Start typing your answer here…"
              className="flex-1 min-h-[320px] font-mono text-sm"
            />
            <div className="flex items-center justify-between text-xs">
              <span
                className={
                  wordCount < limits.hardMin
                    ? "text-red-600"
                    : wordCount >= limits.min && wordCount <= limits.max
                      ? "text-green-600"
                      : "text-amber-600"
                }
              >
                {wordCount} words · target {limits.min}–{limits.max}
                {wordCount < limits.hardMin && ` · below ${limits.hardMin} → К1=0`}
              </span>
              <Button
                onClick={() => setSubmittedAt(Date.now())}
                disabled={!essay.trim()}
              >
                Evaluate
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* RIGHT: AI feedback */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Tutor feedback</CardTitle>
            <CardDescription>
              FIPI-aligned, Socratic. Submit a draft to see feedback stream in.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            <ChatBox
              key={chatKey}
              module={task as TutorModule}
              initialMessages={initialMessages as never}
              variant="feedback"
              placeholder="Ask a follow-up about the feedback…"
              className="h-full"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TaskToggle({
  value,
  onChange,
}: {
  value: "writing-37" | "writing-38";
  onChange: (v: "writing-37" | "writing-38") => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-800 p-1 text-sm">
      <button
        className={`rounded px-3 py-1 ${
          value === "writing-37"
            ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
            : ""
        }`}
        onClick={() => onChange("writing-37")}
      >
        Task 37
      </button>
      <button
        className={`rounded px-3 py-1 ${
          value === "writing-38"
            ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
            : ""
        }`}
        onClick={() => onChange("writing-38")}
      >
        Task 38
      </button>
    </div>
  );
}
