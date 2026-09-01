/**
 * Probe the PublicNode public Yellowstone gRPC endpoint over TLS.
 * Subscribes to slots (always streaming) + pump.fun txns (proves real tx flow),
 * reports counts + latency, then exits. No token required for publicnode.
 *
 *   GRPC_ENDPOINT=https://solana-yellowstone-grpc.publicnode.com:443 npx tsx yellowstone-pn.ts
 */
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";

const ENDPOINT =
  process.env.GRPC_ENDPOINT || "https://solana-yellowstone-grpc.publicnode.com:443";
const XTOKEN = process.env.GRPC_XTOKEN || undefined; // publicnode = none
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const RUN_MS = 20000;

(async () => {
  console.log(`[pn] connecting to ${ENDPOINT} ...`);
  console.log(`[pn] token present=${!!XTOKEN} len=${XTOKEN?.length ?? 0}`);
  const t0 = Date.now();
  let updates = 0, slots = 0, txns = 0, pings = 0;
  let firstSlot: string | undefined;
  let lastSlot: string | undefined;

  try {
    const client = new Client(ENDPOINT, XTOKEN, {
      "grpc.max_receive_message_length": 64 * 1024 * 1024,
    });

    // quick sanity: server version / slot
    try {
      const v = await client.getVersion();
      console.log(`[pn] getVersion OK: ${JSON.stringify(v)}`);
    } catch (e) {
      console.log(`[pn] getVersion failed (may be disabled): ${(e as Error).message}`);
    }

    const stream = await client.subscribe();
    console.log(`[pn] stream opened after ${Date.now() - t0}ms`);

    stream.on("data", (u: any) => {
      updates++;
      if (u.slot) { slots++; lastSlot = u.slot.slot; if (!firstSlot) firstSlot = u.slot.slot; }
      if (u.transaction) txns++;
      if (u.ping) pings++;
      if (updates <= 5) console.log(`[pn] update #${updates} keys=${Object.keys(u).join(",")}`);
    });
    stream.on("error", (e: Error) => console.log(`[pn] STREAM ERROR: ${e.message}`));
    stream.on("end", () => console.log(`[pn] stream ended`));

    await new Promise<void>((resolve, reject) => {
      stream.write(
        {
          slots: { client: { filterByCommitment: false } },
          accounts: {},
          transactions: {
            pump: { vote: false, failed: false, accountInclude: [PUMP], accountExclude: [], accountRequired: [] },
          },
          transactionsStatus: {},
          blocks: {}, blocksMeta: {}, entry: {},
          commitment: CommitmentLevel.PROCESSED,
          accountsDataSlice: [],
        },
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
    console.log(`[pn] subscribed OK after ${Date.now() - t0}ms — watching ${RUN_MS / 1000}s`);

    await new Promise((r) => setTimeout(r, RUN_MS));
    console.log(`\n[pn] RESULT: ${updates} updates (${slots} slot, ${txns} pump-tx, ${pings} ping) in ${RUN_MS / 1000}s`);
    if (firstSlot) console.log(`[pn] slot range: ${firstSlot} -> ${lastSlot}`);
    console.log(updates === 0
      ? "[pn] VERDICT: connected but streamed NOTHING"
      : "[pn] VERDICT: endpoint IS live and streaming ✅");
    process.exit(0);
  } catch (e) {
    console.log(`[pn] CONNECT FAILED after ${Date.now() - t0}ms: ${(e as Error).message}`);
    console.log("[pn] VERDICT: could not connect (TLS/endpoint/token issue)");
    process.exit(1);
  }
})();
