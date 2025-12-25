import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { generateWalletForUser } from "./wallet";

// Get wallet encryption secret from env (AUTH_SECRET is the NextAuth v5 standard)
// SECURITY: No fallback - must be configured in production
const WALLET_ENCRYPTION_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;

if (!WALLET_ENCRYPTION_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("AUTH_SECRET or NEXTAUTH_SECRET must be set in production");
}

// Only use fallback in development
const WALLET_SECRET = WALLET_ENCRYPTION_SECRET || "dev-only-secret-do-not-use-in-production";

/**
 * Generate a Solana wallet for a user if they don't have one
 */
async function ensureUserHasWallet(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { walletAddress: true },
  });

  if (user?.walletAddress) {
    return user.walletAddress;
  }

  // Generate new wallet
  const { publicKey, encryptedPrivateKey } = generateWalletForUser(WALLET_SECRET);

  // Store in database
  await prisma.user.update({
    where: { id: userId },
    data: {
      walletAddress: publicKey,
      walletEncrypted: encryptedPrivateKey,
    },
  });

  console.log(`Generated Solana wallet ${publicKey} for user ${userId}`);
  return publicKey;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    // Google OAuth
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    // Email/Password credentials (stored in Supabase PostgreSQL)
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        // Find user in database
        const user = await prisma.user.findUnique({
          where: { email },
        });

        // If user doesn't exist, create a new account with wallet
        if (!user) {
          // Hash password
          const passwordHash = await bcrypt.hash(password, 12);

          // Generate wallet
          const { publicKey, encryptedPrivateKey } = generateWalletForUser(WALLET_SECRET);

          // Create new user with wallet
          const newUser = await prisma.user.create({
            data: {
              email,
              passwordHash,
              name: email.split("@")[0],
              walletAddress: publicKey,
              walletEncrypted: encryptedPrivateKey,
            },
          });

          console.log(`Created new user ${email} with wallet ${publicKey}`);

          return {
            id: newUser.id,
            email: newUser.email,
            name: newUser.name,
          };
        }

        // If user exists but has no password (OAuth only), don't allow credentials login
        if (!user.passwordHash) {
          console.warn(`User ${email} has no password set (OAuth-only account)`);
          return null;
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.passwordHash);

        if (!isValid) {
          console.warn(`Invalid password attempt for ${email}`);
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  pages: {
    signIn: "/",
  },
  events: {
    // Generate wallet after OAuth sign-in (Google, etc.)
    async signIn({ user, account }) {
      console.log(`[auth] signIn event - user: ${user?.id}, provider: ${account?.provider}`);
      if (user.id && account?.provider !== "credentials") {
        // For OAuth providers, ensure user has a wallet
        await ensureUserHasWallet(user.id);
      }
    },
  },
  callbacks: {
    async jwt({ token, user, account, trigger }) {
      console.log(`[auth] jwt callback - trigger: ${trigger}, hasUser: ${!!user}, hasAccount: ${!!account}`);
      if (user) {
        token.id = user.id;
      }
      if (account?.provider === "google") {
        token.provider = "google";
      }

      // Fetch user data on sign-in, update, or if missing from token
      // This ensures name/username changes are reflected in the session
      if (token.id && (trigger === "signIn" || trigger === "update" || !token.walletAddress)) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { walletAddress: true, name: true, username: true, image: true },
        });
        if (dbUser) {
          token.walletAddress = dbUser.walletAddress ?? undefined;
          token.name = dbUser.name ?? undefined;
          token.username = dbUser.username ?? undefined;
          token.picture = dbUser.image ?? undefined;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.name = token.name as string | undefined;
        session.user.image = token.picture as string | undefined;
        (session.user as { walletAddress?: string }).walletAddress = token.walletAddress as string | undefined;
        (session.user as { username?: string }).username = token.username as string | undefined;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
  trustHost: true,
  // Let NextAuth handle cookies automatically - explicit config was causing signout issues
  // The old cookies without domain attribute conflicted with new domain-scoped cookies
});
