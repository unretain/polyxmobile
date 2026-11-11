/**
 * Raw gRPC probe: connect to the node, subscribe to pump.fun, and report whether
 * ANY data streams through. No decoding — just counts raw updates. Times out.
 */
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";

const ENDPOINT = process.env.GRPC_ENDPOINT || "http://208.82.62.245:10000";
const TOKEN = process.env.GRPC_TOKEN || undefined;
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const RUN_MS = 25000;

(async () => {
  console.log(`[probe] connecting to ${ENDPOINT} ...`);
  const t0 = Date.now();
  let updates = 0;
  let txns = 0;
  try {
    const client = new Client(ENDPOINT, TOKEN, { "grpc.max_receive_message_length": 64 * 1024 * 1024 });
    const stream = await client.subscribe();
    console.log(`[probe] stream opened after ${Date.now() - t0}ms`);

    stream.on("data", (u: any) => {
      updates++;
      if (u.transaction) txns++;
      if (updates <= 3) console.log(`[probe] update #${updates} keys=${Object.keys(u).join(",")}`);
    });
    stream.on("error", (e: Error) => console.log(`[probe] STREAM ERROR: ${e.message}`));
    stream.on("end", () => console.log(`[probe] stream ended`));

    await new Promise<void>((resolve, reject) => {
      stream.write({
        slots: {}, accounts: {},
        transactions: { pump: { vote: false, failed: false, accountInclude: [PUMP], accountExclude: [], accountRequired: [] } },
        transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {},
        commitment: CommitmentLevel.CONFIRMED, accountsDataSlice: [],
      }, (err: Error | null) => (err ? reject(err) : resolve()));
    });
    console.log(`[probe] subscribed OK after ${Date.now() - t0}ms — watching ${RUN_MS / 1000}s`);

    await new Promise((r) => setTimeout(r, RUN_MS));
    console.log(`\n[probe] RESULT: ${updates} updates, ${txns} transactions in ${RUN_MS / 1000}s`);
    console.log(updates === 0 ? "[probe] VERDICT: node accepted the sub but streamed NOTHING (validator not producing)" : "[probe] VERDICT: node IS streaming data");
    process.exit(0);
  } catch (e) {
    console.log(`[probe] CONNECT FAILED after ${Date.now() - t0}ms: ${(e as Error).message}`);
    console.log("[probe] VERDICT: could not even connect (IP not whitelisted, or node/port down)");
    process.exit(1);
  }
})();
