import { redirect } from "next/navigation";
import Link from "next/link";

import { auth } from "@/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/dashboard");
  }

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <DashLink href="/dashboard">Все экзамены</DashLink>
        <DashLink href="/dashboard/ege_en">ЕГЭ</DashLink>
        <DashLink href="/dashboard/oge_en">ОГЭ</DashLink>
      </nav>
      {children}
    </div>
  );
}

function DashLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full border border-zinc-200 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
    >
      {children}
    </Link>
  );
}
