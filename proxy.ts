/**
 * Next.js 16 `proxy.ts` (replaces the old `middleware.ts` convention).
 *
 * Uses the edge-safe `authConfig` (no database / bcrypt imports) to gate
 * `/dashboard/*` routes. The full Auth.js instance — including the Drizzle
 * adapter and Credentials provider — lives in `./auth.ts`.
 */
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Run on every non-static route.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
