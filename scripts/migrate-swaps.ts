import { PrismaClient } from "@prisma/client";

// Old database
const oldDb = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres.jbnfarakhztukmwslovd:Fully54$@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
    },
  },
});

// New database
const newDb = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres.jjnnpsgcnhlpiqabmvju:iMasitbackwitablunt@aws-0-us-west-2.pooler.supabase.com:5432/postgres",
    },
  },
});

async function migrate() {
  console.log("Full swap migration (skip duplicates)...\n");

  try {
    const totalCount = await oldDb.tokenSwap.count();
    console.log(`Total swaps in old DB: ${totalCount.toLocaleString()}\n`);

    // Use offset-based pagination
    const batchSize = 1000;
    let offset = 0;
    let inserted = 0;

    while (offset < totalCount) {
      const swaps = await oldDb.tokenSwap.findMany({
        skip: offset,
        take: batchSize,
        orderBy: { timestamp: "asc" },
      });

      if (swaps.length === 0) break;

      const result = await newDb.tokenSwap.createMany({
        data: swaps.map(s => ({
          tokenAddress: s.tokenAddress,
          txHash: s.txHash,
          timestamp: s.timestamp,
          type: s.type,
          walletAddress: s.walletAddress,
          tokenAmount: s.tokenAmount,
          solAmount: s.solAmount,
          priceUsd: s.priceUsd,
          totalValueUsd: s.totalValueUsd,
        })),
        skipDuplicates: true,
      });

      inserted += result.count;
      offset += swaps.length;

      const pct = ((offset / totalCount) * 100).toFixed(1);
      console.log(`${offset.toLocaleString()}/${totalCount.toLocaleString()} (${pct}%) - inserted ${inserted.toLocaleString()}`);

      // Small delay
      await new Promise(r => setTimeout(r, 30));
    }

    console.log(`\n✅ Done! Processed ${offset.toLocaleString()} rows, inserted ${inserted.toLocaleString()} new swaps`);

    // Final count
    const finalCount = await newDb.tokenSwap.count();
    console.log(`Total swaps in new DB: ${finalCount.toLocaleString()}`);

    // Migrate TokenSyncStatus
    console.log("\nMigrating sync status...");
    const syncStatuses = await oldDb.tokenSyncStatus.findMany();
    for (const ss of syncStatuses) {
      await newDb.tokenSyncStatus.upsert({
        where: { tokenAddress: ss.tokenAddress },
        update: ss,
        create: ss,
      });
    }
    console.log(`✅ Migrated ${syncStatuses.length} sync statuses`);

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  }
}

migrate();
