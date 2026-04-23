import { redirect } from "next/navigation";

/**
 * Legacy `/dashboard/writing` route from Phase 1. Phase 2 moved the Writing
 * module to `/dashboard/[examCode]/writing` so each exam (ЕГЭ/ОГЭ) can
 * render its own task set. We default old links to ЕГЭ — the original
 * target of the MVP — so bookmarks keep working.
 */
export default function LegacyWritingRedirect() {
  redirect("/dashboard/ege_en/writing");
}
