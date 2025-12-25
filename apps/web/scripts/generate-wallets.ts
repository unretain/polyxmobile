/**
 * Generate new wallets for all users who don't have one
 */

import { PrismaClient } from "@prisma/client";
import { generateWalletForUser } from "../src/lib/wallet";

const prisma = new PrismaClient();

const AUTH_SECRET = process.env.AUTH_SECRET || "M/HqRNAhLUiUmA3FYLKhUtxXv4viaZ/cw4XjfbCwphM=";

async function generateWallets() {
  console.log("🔑 Generating wallets for all users...\n");

  const users = await prisma.user.findMany({
    where: {
      walletAddress: null,
    },
    select: {
      id: true,
      email: true,
    },
  });

  console.log(`Found ${users.length} users without wallets.\n`);

  for (const user of users) {
    try {
      const { publicKey, encryptedPrivateKey } = generateWalletForUser(AUTH_SECRET);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          walletAddress: publicKey,
          walletEncrypted: encryptedPrivateKey,
        },
      });

      console.log(`✅ ${user.email}: ${publicKey}`);
    } catch (error) {
      console.error(`❌ ${user.email}: Failed -`, error);
    }
  }

  console.log("\n✅ Done!");
}

generateWallets()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
