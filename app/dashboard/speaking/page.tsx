import { redirect } from "next/navigation";

/**
 * Legacy `/dashboard/speaking` route from Phase 1, redirected to the ЕГЭ
 * speaking module. See `app/dashboard/writing/page.tsx` for the rationale.
 */
export default function LegacySpeakingRedirect() {
  redirect("/dashboard/ege_en/speaking");
}
