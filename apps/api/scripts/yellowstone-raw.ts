/**
 * Raw Geyser client that can put the PublicNode token in the request PATH
 * (which the triton wrapper refuses to do). Reuses the package's own
 * encode/decode so wire format is identical.
 *
 *   MODE=path   -> path /<token>/geyser.Geyser/Subscribe   (publicnode style)
 *   MODE=header -> path /geyser.Geyser/Subscribe + x-token metadata
 *   MODE=both   -> path-prefix AND x-token
 */
import * as grpc from "@grpc/grpc-js";
import { createRequire } from "module";
import * as path from "path";

// Load the package's internal geyser codec by absolute path (exports map blocks the subpath).
const req = createRequire(path.join(process.cwd(), "noop.js"));
const pkgMain = req.resolve("@triton-one/yellowstone-grpc");
const geyser = req(path.join(path.dirname(pkgMain), "grpc", "geyser.js"));
const { SubscribeRequest, SubscribeUpdate, CommitmentLevel } = geyser;

const HOST = process.env.GRPC_HOST || "solana-yellowstone-grpc.publicnode.com:443";
const TOKEN = process.env.TOKEN || "84b4b64b65a8c1eebc813168f9f5c88ad07652042860215b7b5cfb933c673915";
const MODE = (process.env.MODE || "path").toLowerCase();
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const RUN_MS = Number(process.env.RUN_MS || 20000);

const basePath = "/geyser.Geyser/Subscribe";
const rpcPath = MODE === "header" ? basePath : `/${TOKEN}${basePath}`;

const serialize = (r: any) => Buffer.from(SubscribeRequest.encode(r).finish());
const deserialize = (buf: Buffer) => SubscribeUpdate.decode(buf);

(async () => {
  console.log(`[raw] host=${HOST} mode=${MODE}`);
  console.log(`[raw] path=${rpcPath.replace(TOKEN, TOKEN.slice(0, 6) + "…")}`);
  const t0 = Date.now();
  const client = new grpc.Client(HOST, grpc.credentials.createSsl(), {
    "grpc.max_receive_message_length": 64 * 1024 * 1024,
  });

  const md = new grpc.Metadata();
  const hdr = process.env.HEADER || "x-token";
  const val = process.env.BEARER ? `Bearer ${TOKEN}` : TOKEN;
  if (MODE === "header" || MODE === "both") { md.add(hdr, val); console.log(`[raw] metadata: ${hdr}=${val.slice(0,10)}…`); }

  const call: any = (client as any).makeBidiStreamRequest(rpcPath, serialize, deserialize, md);

  let updates = 0, slots = 0, txns = 0;
  let firstSlot: string | undefined, lastSlot: string | undefined;

  call.on("data", (u: any) => {
    updates++;
    if (u.slot) { slots++; lastSlot = u.slot.slot; if (!firstSlot) firstSlot = lastSlot; }
    if (u.transaction) txns++;
    if (updates <= 5) console.log(`[raw] update #${updates} keys=${Object.keys(u).filter((k) => u[k] != null).join(",")}`);
  });
  call.on("error", (e: any) => console.log(`[raw] ERROR ${e.code ?? ""}: ${e.details ?? e.message}`));
  call.on("end", () => console.log(`[raw] stream end`));

  const request = {
    accounts: {}, slots: { client: { filterByCommitment: false } },
    transactions: { pump: { vote: false, failed: false, accountInclude: [PUMP], accountExclude: [], accountRequired: [] } },
    transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {},
    commitment: CommitmentLevel.PROCESSED, accountsDataSlice: [], ping: undefined,
  };
  call.write(request, (err: any) => console.log(err ? `[raw] write err: ${err.message}` : `[raw] subscribe sent (${Date.now() - t0}ms)`));

  await new Promise((r) => setTimeout(r, RUN_MS));
  console.log(`\n[raw] RESULT: ${updates} updates (${slots} slot, ${txns} pump-tx) in ${RUN_MS / 1000}s`);
  if (firstSlot) console.log(`[raw] slots ${firstSlot} -> ${lastSlot}`);
  console.log(updates === 0 ? "[raw] VERDICT: no data" : "[raw] VERDICT: STREAMING ✅");
  try { call.cancel(); } catch {}
  process.exit(0);
})();
