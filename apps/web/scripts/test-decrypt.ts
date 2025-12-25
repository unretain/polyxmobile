import { PrismaClient } from "@prisma/client";
import { decryptPrivateKey } from "../src/lib/wallet";

const prisma = new PrismaClient();
const SECRET = "M/HqRNAhLUiUmA3FYLKhUtxXv4viaZ/cw4XjfbCwphM=";

async function test() {
  const user = await prisma.user.findFirst({
    where: { email: "owenzimmermann06@gmail.com" },
    select: { walletAddress: true, walletEncrypted: true }
  });

  if (!user?.walletEncrypted) {
    console.log("No encrypted wallet found");
    return;
  }

  try {
    const privateKey = decryptPrivateKey(user.walletEncrypted, SECRET);
    console.log("✅ Decryption works!");
    console.log("Wallet:", user.walletAddress);
    console.log("Private key starts with:", privateKey.substring(0, 8) + "...");
  } catch (e: any) {
    console.log("❌ Decryption failed:", e.message);
  }

  await prisma.$disconnect();
}
test();
