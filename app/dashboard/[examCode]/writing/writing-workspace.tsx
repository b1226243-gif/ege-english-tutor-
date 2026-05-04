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
import type { SupportedExamCode, WritingTaskConfig } from "@/lib/exams";

type Props = {
  examCode: SupportedExamCode;
  tasks: WritingTaskConfig[];
};

/**
 * Writing workspace — split-screen composer + AI feedback.
 *
 * The task list (`tasks`) is injected by the server component so we render
 * the right toggle set per exam:
 *   - ЕГЭ → Task 37 (email 100–140) + Task 38 (opinion essay 180–275)
 *   - ОГЭ → Task 33 (email 100–120)
 */
export function WritingWorkspace({ examCode, tasks }: Props) {
  const [activeIdx, setActiveIdx] = React.useState(0);
  const task = tasks[activeIdx];

  const [essay, setEssay] = React.useState("");
  const [submittedAt, setSubmittedAt] = React.useState(0);

  // Switch task + wipe the current draft in a single click handler so we
  // avoid chained setState inside an effect.
  const switchTask = React.useCallback((idx: number) => {
    setActiveIdx(idx);
    setEssay("");
    setSubmittedAt(0);
  }, []);

  const wordCount = React.useMemo(
    () => essay.trim().split(/\s+/).filter(Boolean).length,
    [essay],
  );

  const chatKey = `${task.module}-${submittedAt}`;

  const autoSubmit = React.useMemo(() => {
    if (submittedAt === 0) return undefined;
    return `Please evaluate the following ${task.longLabel} strictly according to the official FIPI 2024/25 criteria for the ${examCode === "ege_en" ? "ЕГЭ" : "ОГЭ"} English exam.\n\n---\n${essay}\n---\n\nWord count (student-side estimate): ${wordCount}.`;
  }, [submittedAt, task.longLabel, examCode, essay, wordCount]);

  const wordColor =
    wordCount < task.hardMin
      ? "text-red-600"
      : wordCount >= task.minWords && wordCount <= task.maxWords
        ? "text-green-600"
        : "text-amber-600";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight mr-auto">
          Письмо ·{" "}
          {examCode === "ege_en" ? "ЕГЭ" : "ОГЭ"}
        </h1>
        {tasks.length > 1 && (
          <TaskToggle
            tasks={tasks}
            activeIdx={activeIdx}
            onChange={switchTask}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 min-h-[70vh]">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>{task.longLabel}</CardTitle>
            <CardDescription>{task.cardDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-3">
            <Textarea
              value={essay}
              onChange={(e) => setEssay(e.target.value)}
              placeholder="Начните набирать ответ здесь…"
              className="flex-1 min-h-[320px] font-mono text-sm"
            />
            <div className="flex items-center justify-between text-xs">
              <span className={wordColor}>
                {wordCount} слов · цель {task.minWords}–{task.maxWords}
                {wordCount < task.hardMin &&
                  ` · ниже ${task.hardMin} → К1=0`}
              </span>
              <Button
                onClick={() => setSubmittedAt(Date.now())}
                disabled={!essay.trim()}
              >
                Оценить
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Фидбек тьютора</CardTitle>
            <CardDescription>
              Строго по FIPI 2024/25, сократический метод. Отправьте черновик,
              чтобы получить разбор.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            <ChatBox
              key={chatKey}
              module={task.module}
              autoSubmit={autoSubmit}
              variant="feedback"
              placeholder="Уточните любую деталь оценки…"
              className="h-full"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TaskToggle({
  tasks,
  activeIdx,
  onChange,
}: {
  tasks: WritingTaskConfig[];
  activeIdx: number;
  onChange: (idx: number) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-800 p-1 text-sm">
      {tasks.map((t, idx) => (
        <button
          key={t.module}
          type="button"
          onClick={() => onChange(idx)}
          className={
            idx === activeIdx
              ? "rounded px-3 py-1 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded px-3 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }
        >
          {t.shortLabel}
        </button>
      ))}
    </div>
  );
}
