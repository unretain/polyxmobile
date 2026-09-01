// LAUNCH A TOKEN on the Polyx Launchpad.
// Paste into SolPG's "Client" panel and press Run. Needs a few devnet SOL
// (faucet.solana.com). Prints your new token's mint + curve so you can trade it.

import {
  PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const program = pg.program;
const me = pg.wallet.publicKey;

const seed = (s: string) => Buffer.from(s);
const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];

const global = pda([seed("global")]);

// 1) Initialize the launchpad config ONCE (skipped if already done).
//    graduationSolLamports is low (0.5 SOL) so you can graduate on devnet cheaply.
//    For mainnet you'd raise it (e.g. 85 SOL).
const g = await pg.connection.getAccountInfo(global);
if (!g) {
  await program.methods
    .initialize({
      mintDecimals: 6,
      tokenTotalSupply: new BN("1000000000000000"),        // 1B tokens
      initialVirtualTokenReserves: new BN("1073000000000000"),
      initialVirtualSolReserves: new BN("30000000000"),     // 30 SOL
      initialRealTokenReserves: new BN("793100000000000"),
      graduationSolLamports: new BN("500000000"),           // 0.5 SOL to graduate
    })
    .accounts({ global, authority: me, systemProgram: SystemProgram.programId })
    .rpc();
  console.log("✅ launchpad initialized");
} else {
  console.log("launchpad already initialized");
}

// 2) Create (launch) a new token.
const mintKp = Keypair.generate();
const mint = mintKp.publicKey;
const curve = pda([seed("bonding_curve"), mint.toBuffer()]);
const curveVault = getAssociatedTokenAddressSync(mint, curve, true);

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
    rent: web3.SYSVAR_RENT_PUBKEY,
  })
  .signers([mintKp])
  .rpc();

console.log("🚀 TOKEN LAUNCHED");
console.log("   mint:        ", mint.toBase58());
console.log("   bondingCurve:", curve.toBase58());
console.log("   view:        https://solscan.io/token/" + mint.toBase58() + "?cluster=devnet");

// 3) Optional: buy a bit immediately so it's got a price.
const myAta = getAssociatedTokenAddressSync(mint, me, true);
const { createAssociatedTokenAccountIdempotentInstruction } = await import("@solana/spl-token");
await program.methods
  .buy(new BN(0.05 * LAMPORTS_PER_SOL), new BN(0))
  .accounts({
    global, bondingCurve: curve, mint, curveVault, userAta: myAta, user: me,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  })
  .preInstructions([createAssociatedTokenAccountIdempotentInstruction(me, myAta, me, mint)])
  .rpc();

const bal = await pg.connection.getTokenAccountBalance(myAta);
console.log("   first buy: you now hold", bal.value.uiAmountString, "tokens");
