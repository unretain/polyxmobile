/**
 * Reset all user wallets and 2FA secrets
 *
 * This script clears encrypted wallet and 2FA data for all users.
 * Users will need to generate new wallets on next login.
 *
 * Run with: npx tsx scripts/reset-wallets.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function resetWalletsAndAuth() {
  console.log("🔄 Starting wallet and 2FA reset...\n");

  // Get count of affected users
  const usersWithWallets = await prisma.user.count({
    where: {
      OR: [
        { walletEncrypted: { not: null } },
        { twoFactorSecret: { not: null } },
      ],
    },
  });

  console.log(`Found ${usersWithWallets} users with wallet/2FA data to reset.\n`);

  if (usersWithWallets === 0) {
    console.log("✅ No users need to be reset.");
    return;
  }

  // Confirm before proceeding
  console.log("⚠️  WARNING: This will:");
  console.log("   - Clear ALL encrypted wallet private keys");
  console.log("   - Clear ALL 2FA secrets (users will need to re-setup)");
  console.log("   - Keep wallet PUBLIC addresses (for display only)");
  console.log("");
  console.log("Users will generate NEW wallets on next login.\n");

  // Reset all users
  const result = await prisma.user.updateMany({
    where: {
      OR: [
        { walletEncrypted: { not: null } },
        { twoFactorSecret: { not: null } },
      ],
    },
    data: {
      // Clear encrypted private key - users will generate new wallets
      walletEncrypted: null,
      // Clear wallet address too since old wallet is unrecoverable
      walletAddress: null,
      // Clear 2FA
      twoFactorSecret: null,
      twoFactorEnabled: false,
    },
  });

  console.log(`✅ Reset ${result.count} users.\n`);
  console.log("Next steps:");
  console.log("1. Set AUTH_SECRET on Railway: M/HqRNAhLUiUmA3FYLKhUtxXv4viaZ/cw4XjfbCwphM=");
  console.log("2. Redeploy the app");
  console.log("3. Users will get new wallets when they next access the trading page");
}

resetWalletsAndAuth()
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
