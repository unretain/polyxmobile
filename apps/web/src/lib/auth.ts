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

// Custom adapter that doesn't overwrite name/image on OAuth sign-in
const basePrismaAdapter = PrismaAdapter(prisma);
const customAdapter = {
  ...basePrismaAdapter,
  // Override updateUser to preserve user-set name/image
  async updateUser(data: Parameters<NonNullable<typeof basePrismaAdapter.updateUser>>[0]) {
    // Don't update name or image from OAuth - user may have customized them
    // Strip out name and image, keep everything else
    const { name, image, ...safeData } = data;
    // Use the base adapter's updateUser with the filtered data
    return basePrismaAdapter.updateUser!(safeData as typeof data);
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: customAdapter,
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

        // Check if this is a Phantom wallet login (email ends with @phantom)
        const isPhantomLogin = email.endsWith("@phantom");

        // Find user in database
        const user = await prisma.user.findUnique({
          where: { email },
        });

        // If user doesn't exist, create a new account with wallet
        if (!user) {
          // Hash password
          const passwordHash = await bcrypt.hash(password, 12);

          // For Phantom users, use their connected wallet address directly
          // For regular users, generate a new wallet
          let walletAddress: string;
          let walletEncrypted: string | null = null;

          if (isPhantomLogin) {
            // For Phantom users, the password IS the public key
            // They bring their own wallet, we don't generate one
            walletAddress = password;
            console.log(`Creating Phantom user with connected wallet ${walletAddress}`);
          } else {
            // Generate wallet for regular users
            const wallet = generateWalletForUser(WALLET_SECRET);
            walletAddress = wallet.publicKey;
            walletEncrypted = wallet.encryptedPrivateKey;
          }

          // Create new user with wallet
          const newUser = await prisma.user.create({
            data: {
              email,
              passwordHash,
              name: isPhantomLogin ? `Phantom_${email.split("@")[0]}` : email.split("@")[0],
              walletAddress,
              walletEncrypted,
              // Phantom users are auto-verified (no email to verify)
              emailVerified: isPhantomLogin ? new Date() : null,
            },
          });

          console.log(`Created new user ${email} with wallet ${walletAddress}`);

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
      if (user.id && account?.provider !== "credentials") {
        // For OAuth providers, ensure user has a wallet
        await ensureUserHasWallet(user.id);
      }
    },
  },
  callbacks: {
    async jwt({ token, user, account, trigger }) {
      if (user) {
        token.id = user.id;
      }
      if (account?.provider === "google") {
        token.provider = "google";
      }

      // Only fetch user data on sign-in or explicit update trigger
      // Don't fetch on every request - that's what makes things slow
      if (token.id && (trigger === "signIn" || trigger === "update")) {
        try {
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
        } catch (error) {
          console.error(`[Auth] Error fetching user data:`, error);
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
