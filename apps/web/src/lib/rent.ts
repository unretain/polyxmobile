/**
 * Token-account rent recovery.
 *
 * Every SPL token you've ever held keeps a token account alive at ~0.00204 SOL
 * of rent. Selling to zero doesn't close the account, the rent just sits
 * there. These helpers find empty token accounts and close them (client-signed,
 * rent returns to the wallet):
 *  - the Portfolio banner batches all of them behind a Claim button
 *  - sells auto-close the account they just emptied (see mobileSwap)
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { createCloseAccountInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { deriveKeypairFromMnemonic } from "./mobileWallet";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";

export const RENT_PER_ACCOUNT_SOL = 0.00203928;
const MAX_CLOSES_PER_TX = 16;

function conn(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

export interface ReclaimableRent {
  /** Empty token-account addresses (base58). */
  accounts: string[];
  /** Total SOL locked in them. */
  sol: number;
}

/** Find this wallet's token accounts with a zero balance. Read-only. */
export async function getReclaimableRent(owner: string): Promise<ReclaimableRent> {
  const res = await conn().getParsedTokenAccountsByOwner(new PublicKey(owner), {
    programId: TOKEN_PROGRAM_ID,
  });
  const empty = res.value.filter((a) => {
    const amt = a.account.data?.parsed?.info?.tokenAmount;
    return amt && amt.amount === "0";
  });
  return {
    accounts: empty.map((a) => a.pubkey.toBase58()),
    sol: empty.length * RENT_PER_ACCOUNT_SOL,
  };
}

/** Close every empty token account; rent lands back in the wallet. */
export async function claimRent(mnemonic: string): Promise<{ closed: number; sol: number; signature: string | null }> {
  const { secretKey } = deriveKeypairFromMnemonic(mnemonic);
  const keypair = Keypair.fromSecretKey(secretKey);
  const owner = keypair.publicKey;
  try {
    const { accounts } = await getReclaimableRent(owner.toBase58());
    if (accounts.length === 0) return { closed: 0, sol: 0, signature: null };

    const connection = conn();
    let lastSig: string | null = null;
    let closed = 0;
    for (let i = 0; i < accounts.length; i += MAX_CLOSES_PER_TX) {
      const batch = accounts.slice(i, i + MAX_CLOSES_PER_TX);
      const tx = new Transaction();
      for (const acc of batch) {
        tx.add(createCloseAccountInstruction(new PublicKey(acc), owner, owner));
      }
      tx.feePayer = owner;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      tx.sign(keypair);
      lastSig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction(lastSig, "confirmed").catch(() => {});
      closed += batch.length;
    }
    return { closed, sol: closed * RENT_PER_ACCOUNT_SOL, signature: lastSig };
  } finally {
    secretKey.fill(0);
  }
}

/**
 * Best-effort: after a sell, close that mint's token account if it's now empty.
 * Never throws, the sell already succeeded; this is housekeeping.
 */
export async function closeTokenAccountIfEmpty(mnemonic: string, mint: string): Promise<boolean> {
  try {
    const { secretKey } = deriveKeypairFromMnemonic(mnemonic);
    const keypair = Keypair.fromSecretKey(secretKey);
    const owner = keypair.publicKey;
    const connection = conn();
    const res = await connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
    const empty = res.value.filter((a) => a.account.data?.parsed?.info?.tokenAmount?.amount === "0");
    if (empty.length === 0) { secretKey.fill(0); return false; }
    const tx = new Transaction();
    for (const a of empty) tx.add(createCloseAccountInstruction(a.pubkey, owner, owner));
    tx.feePayer = owner;
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(keypair);
    await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 2 });
    secretKey.fill(0);
    return true;
  } catch {
    return false;
  }
}
