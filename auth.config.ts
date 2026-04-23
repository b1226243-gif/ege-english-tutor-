import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";

/**
 * Edge-safe Auth.js config.
 *
 * This file must NOT import anything that relies on Node built-ins
 * (bcryptjs, postgres driver, etc.) — it is re-used from `proxy.ts` which
 * runs on the Edge runtime.
 *
 * Heavy providers (Credentials + Drizzle adapter) live in `./auth.ts`.
 */
export const authConfig = {
  pages: {
    signIn: "/sign-in",
  },
  providers: [
    // GitHub OAuth. Skipped automatically if env vars are missing.
    ...(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
      ? [
          GitHub({
            clientId: process.env.AUTH_GITHUB_ID,
            clientSecret: process.env.AUTH_GITHUB_SECRET,
          }),
        ]
      : []),
  ],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard");
      if (isOnDashboard) return isLoggedIn;
      return true;
    },
  },
} satisfies NextAuthConfig;
