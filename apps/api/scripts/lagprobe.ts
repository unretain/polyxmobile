/**
 * Lag probe: subscribe to the pump.fun firehose and, for each trade event, compare
 * its ON-CHAIN block time to our wall clock at receipt. Near-zero processing, so it
 * isolates relay/source delivery delay from our feed's own processing lag.
 */
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";

const ENDPOINT = process.env.GRPC_ENDPOINT!;
const TOKEN = process.env.GRPC_TOKEN || undefined;
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const SELF_CPI = "e445a52e51cb9a1d";
const TRADE = "bddb7fd34ee661ee";
const RUN_MS = 25000;

const lags: number[] = [];

function scanTx(tx: any) {
  const outer = tx?.transaction?.message?.instructions || [];
  const inner: any[] = [];
  for (const g of tx?.meta?.innerInstructions || []) for (const ix of g.instructions || []) inner.push(ix);
  for (const ix of [...outer, ...inner]) {
    if (!ix.data) continue;
    const b = typeof ix.data === "string" ? Buffer.from(ix.data, "base64") : Buffer.from(ix.data);
    if (b.length < 105) continue;
    if (b.slice(0, 8).toString("hex") !== SELF_CPI) continue;
    if (b.slice(8, 16).toString("hex") !== TRADE) continue;
    // TRADE_EVENT layout after 16B prefix: mint(32) sol(8) tok(8) isBuy(1) user(32) tsSec(i64 @97)
    const tsSec = Number(b.readBigInt64LE(97));
    if (tsSec > 1_600_000_000) lags.push(Date.now() / 1000 - tsSec);
  }
}

(async () => {
  console.log(`[lagprobe] connecting ${ENDPOINT} ...`);
  const client = new Client(ENDPOINT, TOKEN, { "grpc.max_receive_message_length": 64 * 1024 * 1024 });
  const stream = await client.subscribe();
  stream.on("data", (u: any) => { try { if (u.transaction) scanTx(u.transaction.transaction); } catch {} });
  stream.on("error", (e: Error) => console.log("[lagprobe] ERR", e.message));
  await new Promise<void>((res, rej) => stream.write({
    slots: {}, accounts: {},
    transactions: { pump: { vote: false, failed: false, accountInclude: [PUMP], accountExclude: [], accountRequired: [] } },
    transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {},
    commitment: CommitmentLevel.PROCESSED, accountsDataSlice: [],
  }, (e: any) => (e ? rej(e) : res())));
  console.log(`[lagprobe] subscribed — sampling ${RUN_MS / 1000}s (PROCESSED commitment)...`);
  await new Promise((r) => setTimeout(r, RUN_MS));
  lags.sort((a, b) => a - b);
  const n = lags.length;
  if (!n) { console.log("[lagprobe] no trade events seen"); process.exit(0); }
  const q = (p: number) => lags[Math.min(n - 1, Math.floor(n * p))].toFixed(1);
  console.log(`[lagprobe] samples=${n}  min=${lags[0].toFixed(1)}s  p10=${q(0.1)}s  median=${q(0.5)}s  p90=${q(0.9)}s  max=${lags[n - 1].toFixed(1)}s`);
  const med = lags[Math.floor(n / 2)];
  console.log(med < 4
    ? "[lagprobe] VERDICT: raw stream is REAL-TIME -> the lag is OUR processing (a faster box could help)"
    : "[lagprobe] VERDICT: raw stream arrives LATE from the relay/source -> a dedi will NOT fix it; the relay/gRPC provider is the problem");
  process.exit(0);
})();
