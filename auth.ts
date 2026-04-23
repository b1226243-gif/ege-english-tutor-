import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { authConfig } from "./auth.config";
import { db, schema } from "./lib/db";

/**
 * Full Auth.js instance with Drizzle adapter + Credentials provider.
 *
 * Used in all server runtime contexts (API routes, server components).
 * Do NOT import this from `proxy.ts` — that runs on Edge and can't load
 * the postgres driver / bcryptjs. Use `authConfig` directly there.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  // DrizzleAdapter is instantiated lazily below to keep importing this
  // module safe even when DATABASE_URL is not set (e.g. during `next build`
  // on a fresh clone before the env is configured).
  adapter: process.env.DATABASE_URL
    ? DrizzleAdapter(db(), {
        usersTable: schema.users,
        accountsTable: schema.accounts,
        sessionsTable: schema.sessions,
        verificationTokensTable: schema.verificationTokens,
      })
    : undefined,
  session: { strategy: "jwt" },
  // Propagate the user id through the JWT so server-side `auth()` gives us
  // `session.user.id` — without this, Credentials logins yield a session
  // with only name/email/image, breaking any route that scopes work by
  // user id (POST /api/grammar/answer, /api/grammar/explain, /api/chat).
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token?.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  providers: [
    ...authConfig.providers,
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;
        if (!process.env.DATABASE_URL) return null;

        const [user] = await db()
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);

        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
});
