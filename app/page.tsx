import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <section className="mx-auto max-w-5xl w-full px-4 py-16 flex flex-col gap-10">
      <div className="flex flex-col gap-4 items-start">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          EGE 2024/25 · FIPI-aligned
        </span>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          AI English tutor for the Russian Unified State Exam
        </h1>
        <p className="max-w-2xl text-zinc-600 dark:text-zinc-400">
          Strict FIPI 2024/25 scoring. Socratic feedback that leads you to
          self-correct. Dedicated modules for Writing (Tasks 37 & 38) and the
          Speaking simulator (Tasks 1–4).
        </p>
        <div className="flex gap-3">
          <Link href="/dashboard/writing" className={buttonVariants()}>
            Start Writing
          </Link>
          <Link
            href="/dashboard/speaking"
            className={buttonVariants({ variant: "outline" })}
          >
            Try Speaking
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Writing · Task 37</CardTitle>
            <CardDescription>Personal letter / email</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-zinc-600 dark:text-zinc-400">
            100–140 words. К1/К2/К3 evaluated independently. Register, linking
            words, paragraphing, and all required content points are checked.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Writing · Task 38</CardTitle>
            <CardDescription>Opinion essay on a chart / table</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-zinc-600 dark:text-zinc-400">
            180–275 words. 5-paragraph structure enforced. К1–К5 graded
            separately, with targeted mini-drills for your weakest criterion.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Speaking · Tasks 1–4</CardTitle>
            <CardDescription>Examiner simulator</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-zinc-600 dark:text-zinc-400">
            Browser-based voice capture (Web Speech API), transcript review,
            and per-task FIPI scoring up to 20 points.
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
