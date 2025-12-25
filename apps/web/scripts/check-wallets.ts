import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      walletAddress: true,
      walletEncrypted: true,
    }
  });
  console.log("Current users in DB:");
  for (const u of users) {
    const wallet = u.walletAddress || "null";
    const encrypted = u.walletEncrypted ? "YES" : "null";
    console.log("- " + u.email + ": wallet=" + wallet + ", encrypted=" + encrypted);
  }
  await prisma.$disconnect();
}
check();
