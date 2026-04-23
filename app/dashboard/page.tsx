import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function DashboardIndex() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-sm text-zinc-500">
        Choose a module to begin practising.
      </p>
      <div className="flex gap-2">
        <Link href="/dashboard/writing" className={buttonVariants()}>
          Writing
        </Link>
        <Link
          href="/dashboard/speaking"
          className={buttonVariants({ variant: "outline" })}
        >
          Speaking
        </Link>
      </div>
    </div>
  );
}
