// Polyx Launchpad — full lifecycle test for Solana Playground.
//
// Paste this into SolPG's "Test" tab (uses the `pg` globals SolPG injects:
// pg.program, pg.wallet, pg.connection). It runs the whole flow on devnet:
//   initialize (low graduation threshold, cheap to test) → create → buy → sell →
//   buy to graduate → migrate → swap SOL->token → swap token->SOL.
//
// Requires a few devnet SOL in the playground wallet (faucet.solana.com).

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { assert } from "chai";

const program = (pg as any).program;
const wallet = (pg as any).wallet;
const connection = (pg as any).connection;
const me = wallet.publicKey;

const enc = (s: string) => Buffer.from(s);
const GLOBAL_SEED = enc("global");
const CURVE_SEED = enc("bonding_curve");
const POOL_SEED = enc("pool");

const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const ata = (mint: PublicKey, owner: PublicKey) =>
  getAssociatedTokenAddressSync(mint, owner, true);

describe("polyx launchpad lifecycle", () => {
  const global = pda([GLOBAL_SEED]);
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;
  const curve = pda([CURVE_SEED, mint.toBuffer()]);
  const curveVault = ata(mint, curve);
  const pool = pda([POOL_SEED, mint.toBuffer()]);
  const poolVault = ata(mint, pool);
  const lpMintKp = Keypair.generate();
  const poolLpLocked = ata(lpMintKp.publicKey, pool);
  const myAta = ata(mint, me);

  it("initialize (idempotent)", async () => {
    const info = await connection.getAccountInfo(global);
    if (info) {
      console.log("global already initialized, skipping");
      return;
    }
    await program.methods
      .initialize({
        mintDecimals: 6,
        tokenTotalSupply: new anchor.BN("1000000000000000"),        // 1B * 1e6
        initialVirtualTokenReserves: new anchor.BN("1073000000000000"),
        initialVirtualSolReserves: new anchor.BN("30000000000"),     // 30 SOL
        initialRealTokenReserves: new anchor.BN("793100000000000"),
        graduationSolLamports: new anchor.BN("200000000"),           // 0.2 SOL — cheap to graduate in test
      })
      .accounts({ global, authority: me, systemProgram: SystemProgram.programId })
      .rpc();
    console.log("initialized:", global.toBase58());
  });

  it("create token", async () => {
    await program.methods
      .create()
      .accounts({
        global,
        mint,
        bondingCurve: curve,
        curveVault,
        creator: me,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKp])
      .rpc();
    console.log("created mint:", mint.toBase58());
  });

  it("buy 0.05 SOL", async () => {
    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(me, myAta, me, mint);
    await program.methods
      .buy(new anchor.BN(0.05 * LAMPORTS_PER_SOL), new anchor.BN(0))
      .accounts({
        global, bondingCurve: curve, mint, curveVault, userAta: myAta, user: me,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .preInstructions([createAtaIx])
      .rpc();
    const bal = await connection.getTokenAccountBalance(myAta);
    console.log("bought tokens:", bal.value.uiAmountString);
    assert(Number(bal.value.amount) > 0, "should hold tokens");
  });

  it("sell half back", async () => {
    const bal = await connection.getTokenAccountBalance(myAta);
    const half = new anchor.BN(bal.value.amount).divn(2);
    await program.methods
      .sell(half, new anchor.BN(0))
      .accounts({
        global, bondingCurve: curve, mint, curveVault, userAta: myAta, user: me,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("sold half back for SOL");
  });

  it("buy to graduate (0.25 SOL > 0.2 threshold)", async () => {
    await program.methods
      .buy(new anchor.BN(0.25 * LAMPORTS_PER_SOL), new anchor.BN(0))
      .accounts({
        global, bondingCurve: curve, mint, curveVault, userAta: myAta, user: me,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .rpc();
    const c = await program.account.bondingCurve.fetch(curve);
    console.log("curve complete?", c.complete);
    assert(c.complete === true, "curve should have graduated");
  });

  it("migrate to AMM pool", async () => {
    await program.methods
      .migrate()
      .accounts({
        bondingCurve: curve, mint, curveVault,
        pool, lpMint: lpMintKp.publicKey, poolTokenVault: poolVault, poolLpLocked,
        payer: me,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([lpMintKp])
      .rpc();
    const p = await program.account.pool.fetch(pool);
    console.log("pool reserves — token:", p.tokenReserve.toString(), "sol:", p.solReserve.toString(), "lp:", p.lpSupply.toString());
    assert(p.tokenReserve.gtn(0) && p.solReserve.gtn(0), "pool should be seeded");
  });

  it("swap 0.05 SOL -> token on the pool", async () => {
    const before = await connection.getTokenAccountBalance(myAta);
    await program.methods
      .swapSolForToken(new anchor.BN(0.05 * LAMPORTS_PER_SOL), new anchor.BN(0))
      .accounts({
        pool, poolTokenVault: poolVault, userToken: myAta, user: me,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .rpc();
    const after = await connection.getTokenAccountBalance(myAta);
    console.log("pool buy: tokens", before.value.uiAmountString, "->", after.value.uiAmountString);
    assert(Number(after.value.amount) > Number(before.value.amount), "should receive tokens");
  });

  it("swap token -> SOL on the pool", async () => {
    const bal = await connection.getTokenAccountBalance(myAta);
    const amt = new anchor.BN(bal.value.amount).divn(4);
    await program.methods
      .swapTokenForSol(amt, new anchor.BN(0))
      .accounts({
        pool, poolTokenVault: poolVault, userToken: myAta, user: me,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("pool sell: sold", amt.toString(), "tokens for SOL — full lifecycle works ✅");
  });
});
