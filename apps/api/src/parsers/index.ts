import bs58 from "bs58";
import { ParsedSwap, DEX_PROGRAMS } from "../grpc/client";
import { parseRaydiumAmmSwap, parseRaydiumClmmSwap } from "./raydium";
import { parsePumpFunSwap } from "./pumpfun";

interface TransactionInfo {
  signature: string;
  slot: number;
  blockTime?: number;
  meta: {
    preTokenBalances?: Array<{
      accountIndex: number;
      mint: string;
      owner: string;
      uiTokenAmount: {
        amount: string;
        decimals: number;
        uiAmount: number;
      };
    }>;
    postTokenBalances?: Array<{
      accountIndex: number;
      mint: string;
      owner: string;
      uiTokenAmount: {
        amount: string;
        decimals: number;
        uiAmount: number;
      };
    }>;
    preBalances?: number[];
    postBalances?: number[];
  };
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string }>;
      instructions: Array<{
        programIdIndex: number;
        accounts: number[];
        data: string;
      }>;
    };
  };
}

export function parseTransaction(tx: any): ParsedSwap[] {
  const swaps: ParsedSwap[] = [];

  try {
    const signature = tx.signature ? bs58.encode(tx.signature) : "";
    const slot = tx.slot || 0;
    const timestamp = tx.blockTime ? tx.blockTime * 1000 : Date.now();

    const accountKeys = tx.transaction?.message?.accountKeys || [];
    const instructions = tx.transaction?.message?.instructions || [];

    // Build pre/post token balance maps
    const preBalances = new Map<string, { mint: string; amount: bigint }>();
    const postBalances = new Map<string, { mint: string; amount: bigint }>();

    for (const bal of tx.meta?.preTokenBalances || []) {
      const accountKey = accountKeys[bal.accountIndex]?.pubkey;
      if (accountKey) {
        preBalances.set(accountKey, {
          mint: bal.mint,
          amount: BigInt(bal.uiTokenAmount?.amount || "0"),
        });
      }
    }

    for (const bal of tx.meta?.postTokenBalances || []) {
      const accountKey = accountKeys[bal.accountIndex]?.pubkey;
      if (accountKey) {
        postBalances.set(accountKey, {
          mint: bal.mint,
          amount: BigInt(bal.uiTokenAmount?.amount || "0"),
        });
      }
    }

    // Build pre/post SOL balance maps
    const preSolBalances = new Map<string, bigint>();
    const postSolBalances = new Map<string, bigint>();

    const preNativeBalances = tx.meta?.preBalances || [];
    const postNativeBalances = tx.meta?.postBalances || [];

    for (let i = 0; i < accountKeys.length; i++) {
      const key = accountKeys[i]?.pubkey;
      if (key) {
        preSolBalances.set(key, BigInt(preNativeBalances[i] || 0));
        postSolBalances.set(key, BigInt(postNativeBalances[i] || 0));
      }
    }

    // Process each instruction
    for (const ix of instructions) {
      const programId = accountKeys[ix.programIdIndex]?.pubkey;
      if (!programId) continue;

      const ixAccounts = ix.accounts.map((idx: number) => accountKeys[idx]?.pubkey).filter(Boolean);
      const ixData = Buffer.from(bs58.decode(ix.data));

      let swap: ParsedSwap | null = null;

      switch (programId) {
        case DEX_PROGRAMS.RAYDIUM_AMM:
          swap = parseRaydiumAmmSwap(
            signature,
            slot,
            timestamp,
            ixAccounts,
            ixData,
            preBalances,
            postBalances
          );
          break;

        case DEX_PROGRAMS.RAYDIUM_CLMM:
          swap = parseRaydiumClmmSwap(
            signature,
            slot,
            timestamp,
            ixAccounts,
            ixData,
            preBalances,
            postBalances
          );
          break;

        case DEX_PROGRAMS.PUMP_FUN:
          swap = parsePumpFunSwap(
            signature,
            slot,
            timestamp,
            ixAccounts,
            ixData,
            preBalances,
            postBalances,
            preSolBalances,
            postSolBalances
          );
          break;

        // Add more DEX parsers here
      }

      if (swap) {
        swaps.push(swap);
      }
    }
  } catch (error) {
    console.error("Error parsing transaction:", error);
  }

  return swaps;
}

export { parseRaydiumAmmSwap, parseRaydiumClmmSwap } from "./raydium";
export { parsePumpFunSwap } from "./pumpfun";
