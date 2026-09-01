// Polyx Launchpad — upload + "pending coin" backend.
//
// Two launch paths, mirroring pump.fun:
//   • Dev buy > 0: the UI builds & sends the combined create+buy tx itself; the
//     creator is the first buyer and pays the rent. This server just does /upload.
//   • Dev buy = 0: the creator RESERVES a coin here (image+metadata pinned, a mint
//     keypair minted and held server-side). Nothing hits the chain and the creator
//     pays nothing. The coin sits in /pending until the FIRST BUYER calls
//     /launch-tx — that buyer signs the combined tx and absorbs the ~0.0074 SOL
//     rent. Same "first buyer pays" model pump.fun uses.
//
// NOTE: reserved mint secret keys are throwaway, single-use, devnet-only keys kept
// in pending.json. For production move these to a real secret store.
//
// Run:  npm i && node upload.mjs   (listens on :8788, or $PORT)

import express from "express";
import multer from "multer";
import cors from "cors";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import {
  Connection, PublicKey, Keypair, Transaction, TransactionInstruction,
  SystemProgram, SYSVAR_RENT_PUBKEY, LAMPORTS_PER_SOL, ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer(); // memory storage
const PINATA_JWT = process.env.PINATA_JWT || "";
const GATEWAY = "https://gateway.pinata.cloud/ipfs/";

// ---- chain config (matches the UI) ----
const RPC = process.env.SOLANA_RPC_URL || "https://devnet.helius-rpc.com/?api-key=REDACTED";
const PROGRAM_ID = new PublicKey("CCkwT5o6ieiyxuJvMJNtmrVe1tBwKU7sK47QLCnfTgL4");
const conn = new Connection(RPC, "confirmed");

// ---- pending-coin store (persisted so a restart doesn't drop reservations) ----
const STORE = fileURLToPath(new URL("./pending.json", import.meta.url));
let pending = existsSync(STORE) ? JSON.parse(readFileSync(STORE, "utf8")) : {};
const savePending = () => writeFileSync(STORE, JSON.stringify(pending, null, 2));

// ---- borsh-ish encoders (same as the UI) ----
const te = new TextEncoder();
const disc = (n) => createHash("sha256").update("global:" + n).digest().subarray(0, 8);
const encStr = (s) => { const b = te.encode(s); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, Buffer.from(b)]); };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const globalPda = PublicKey.findProgramAddressSync([te.encode("global")], PROGRAM_ID)[0];

// Pin image + metadata JSON; returns the metadata `uri` the token points to.
async function pinMetadata(file, name, symbol, description) {
  const blob = new Blob([file.buffer], { type: file.mimetype || "image/png" });
  if (PINATA_JWT) {
    const imgForm = new FormData();
    imgForm.append("file", blob, file.originalname || "image.png");
    const ir = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST", headers: { Authorization: "Bearer " + PINATA_JWT }, body: imgForm,
    });
    if (!ir.ok) throw new Error("pinata image: " + (await ir.text()));
    const image = GATEWAY + (await ir.json()).IpfsHash;
    const jr = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: { Authorization: "Bearer " + PINATA_JWT, "Content-Type": "application/json" },
      body: JSON.stringify({ name, symbol, description, image, showName: true }),
    });
    if (!jr.ok) throw new Error("pinata json: " + (await jr.text()));
    return { uri: GATEWAY + (await jr.json()).IpfsHash, image };
  }
  // Fallback: proxy pump.fun's public IPFS uploader (no key). Returns { metadataUri }.
  const form = new FormData();
  form.append("file", blob, file.originalname || "image.png");
  form.append("name", name);
  form.append("symbol", symbol);
  form.append("description", description);
  form.append("showName", "true");
  const pr = await fetch("https://pump.fun/api/ipfs", { method: "POST", body: form });
  if (!pr.ok) throw new Error("upload failed: " + (await pr.text()));
  const j = await pr.json();
  return { uri: j.metadataUri, image: j?.metadata?.image };
}

app.get("/health", (_req, res) => res.json({ ok: true, mode: PINATA_JWT ? "pinata" : "pumpfun" }));

// Dev-buy>0 path: just pin and return the uri; the UI builds the tx itself.
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const { name = "", symbol = "", description = "" } = req.body || {};
    if (!file) return res.status(400).json({ error: "no image file" });
    const { uri, image } = await pinMetadata(file, name, symbol, description);
    res.json({ uri, image });
  } catch (e) { console.error(e); res.status(500).json({ error: String(e?.message || e) }); }
});

// Dev-buy=0 path: RESERVE a coin. Pins metadata, mints a held mint keypair, stores
// it pending. Nothing on-chain, creator pays nothing. Returns the mint pubkey.
app.post("/reserve", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const { name = "", symbol = "", description = "", creator = "" } = req.body || {};
    if (!file) return res.status(400).json({ error: "no image file" });
    if (!name || !symbol) return res.status(400).json({ error: "name and symbol required" });
    const { uri, image } = await pinMetadata(file, name, symbol, description);
    const mintKp = Keypair.generate();
    const mint = mintKp.publicKey.toBase58();
    pending[mint] = {
      mint, name, symbol, description, uri, image, creator,
      secret: Array.from(mintKp.secretKey), createdAt: Date.now(),
    };
    savePending();
    res.json({ mint, uri, image });
  } catch (e) { console.error(e); res.status(500).json({ error: String(e?.message || e) }); }
});

// List pending coins (public fields only). Drops any that already materialized on-chain.
app.get("/pending", async (_req, res) => {
  try {
    const out = [];
    for (const p of Object.values(pending)) {
      const info = await conn.getAccountInfo(new PublicKey(p.mint)).catch(() => null);
      if (info) { delete pending[p.mint]; continue; } // already launched
      const { secret, ...pub } = p;
      out.push(pub);
    }
    savePending();
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: String(e?.message || e) }); }
});

app.get("/pending/:mint", (req, res) => {
  const p = pending[req.params.mint];
  if (!p) return res.status(404).json({ error: "not found or already launched" });
  const { secret, ...pub } = p;
  res.json(pub);
});

// Build the combined create+buy transaction for the FIRST BUYER of a pending coin.
// Partial-signed by the held mint keypair; the buyer is fee payer, signs, and pays
// all the rent + their buy. Returns a base64 tx for the wallet to sign & send.
app.post("/launch-tx", async (req, res) => {
  try {
    const { mint: mintStr, buyer: buyerStr, solIn = 0 } = req.body || {};
    const p = pending[mintStr];
    if (!p) return res.status(404).json({ error: "not found or already launched" });
    const buyer = new PublicKey(buyerStr);
    const mintKp = Keypair.fromSecretKey(Uint8Array.from(p.secret));
    const mint = mintKp.publicKey;
    const curve = PublicKey.findProgramAddressSync([te.encode("bonding_curve"), mint.toBuffer()], PROGRAM_ID)[0];
    const curveVault = getAssociatedTokenAddressSync(mint, curve, true, TOKEN_2022_PROGRAM_ID);

    const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })];

    // seed global once if somehow missing (buyer pays; normally already seeded)
    if (!(await conn.getAccountInfo(globalPda))) {
      ixs.push(new TransactionInstruction({ programId: PROGRAM_ID, keys: [
        { pubkey: globalPda, isSigner: false, isWritable: true },
        { pubkey: buyer, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ], data: Buffer.concat([disc("initialize"), Buffer.from([6]),
        u64("1000000000000000"), u64("1073000000000000"), u64("30000000000"),
        u64("793100000000000"), u64("500000000")]) }));
    }

    // create (buyer is payer + creator-of-record; zero-fee so attribution is cosmetic)
    ixs.push(new TransactionInstruction({ programId: PROGRAM_ID, keys: [
      { pubkey: globalPda, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: true, isWritable: true },
      { pubkey: curve, isSigner: false, isWritable: true },
      { pubkey: curveVault, isSigner: false, isWritable: true },
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ], data: Buffer.concat([disc("create"), encStr(p.name), encStr(p.symbol), encStr(p.uri)]) }));

    // first buy (optional, but a first buyer normally buys > 0)
    const lamportsIn = Math.floor(Number(solIn) * LAMPORTS_PER_SOL);
    if (lamportsIn > 0) {
      const myAta = getAssociatedTokenAddressSync(mint, buyer, true, TOKEN_2022_PROGRAM_ID);
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(buyer, myAta, buyer, mint, TOKEN_2022_PROGRAM_ID));
      ixs.push(new TransactionInstruction({ programId: PROGRAM_ID, keys: [
        { pubkey: globalPda, isSigner: false, isWritable: false },
        { pubkey: curve, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: curveVault, isSigner: false, isWritable: true },
        { pubkey: myAta, isSigner: false, isWritable: true },
        { pubkey: buyer, isSigner: true, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ], data: Buffer.concat([disc("buy"), u64(lamportsIn), u64(0)]) }));
    }

    const tx = new Transaction().add(...ixs);
    tx.feePayer = buyer;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.partialSign(mintKp); // mint signs now; buyer signs in their wallet
    const b64 = tx.serialize({ requireAllSignatures: false }).toString("base64");
    res.json({ tx: b64, mint: mint.toBase58() });
  } catch (e) { console.error(e); res.status(500).json({ error: String(e?.message || e) }); }
});

const port = process.env.PORT || 8788;
app.listen(port, () => console.log(`[launchpad] listening on :${port} (mode: ${PINATA_JWT ? "pinata" : "pumpfun"})`));
