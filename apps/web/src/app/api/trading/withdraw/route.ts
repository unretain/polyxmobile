import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptPrivateKey, isValidPublicKey } from "@/lib/wallet";
import { config } from "@/lib/config";
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Keypair,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";

// POST /api/trading/withdraw
export async function POST(req: NextRequest) {
  let secretKey: Uint8Array | null = null;

  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { destinationAddress, amount, tokenMint } = body;

    if (!destinationAddress || !amount) {
      return NextResponse.json(
        { error: "destinationAddress and amount are required" },
        { status: 400 }
      );
    }

    // Validate destination address
    if (!isValidPublicKey(destinationAddress)) {
      return NextResponse.json(
        { error: "Invalid destination address" },
        { status: 400 }
      );
    }

    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { error: "Amount must be a positive number" },
        { status: 400 }
      );
    }

    // Get user wallet
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        walletAddress: true,
        walletEncrypted: true,
      },
    });

    if (!user?.walletAddress || !user?.walletEncrypted) {
      return NextResponse.json(
        { error: "No wallet found" },
        { status: 400 }
      );
    }

    // Prevent sending to self
    if (destinationAddress === user.walletAddress) {
      return NextResponse.json(
        { error: "Cannot withdraw to your own wallet" },
        { status: 400 }
      );
    }

    const connection = new Connection(config.solanaRpcUrl, "confirmed");
    const fromPubkey = new PublicKey(user.walletAddress);
    const toPubkey = new PublicKey(destinationAddress);

    // Decrypt private key
    const privateKeyBase58 = decryptPrivateKey(
      user.walletEncrypted,
      config.authSecret
    );
    secretKey = bs58.decode(privateKeyBase58);
    const signer = Keypair.fromSecretKey(secretKey);

    let signature: string;

    if (!tokenMint || tokenMint === "So11111111111111111111111111111111111111112") {
      // SOL transfer
      const TX_FEE = 5000;
      const balance = await connection.getBalance(fromPubkey);

      let lamports: number;

      // Check balance - need to keep rent-exempt minimum + fee
      lamports = Math.floor(amountNum * LAMPORTS_PER_SOL);
      const RENT_EXEMPT_MINIMUM = 890880;

      if (balance < lamports + RENT_EXEMPT_MINIMUM + TX_FEE) {
        const maxWithdraw = Math.max(0, balance - RENT_EXEMPT_MINIMUM - TX_FEE) / LAMPORTS_PER_SOL;
        return NextResponse.json(
          { error: `Insufficient SOL. Max withdrawable: ${maxWithdraw.toFixed(6)} SOL (need to keep ~0.001 SOL for rent + fees)` },
          { status: 400 }
        );
      }

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports,
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromPubkey;

      transaction.sign(signer);
      signature = await connection.sendRawTransaction(transaction.serialize());
    } else {
      // SPL token transfer
      const mintPubkey = new PublicKey(tokenMint);

      // Get source token account
      const sourceAta = await getAssociatedTokenAddress(mintPubkey, fromPubkey);
      const destAta = await getAssociatedTokenAddress(mintPubkey, toPubkey);

      // Get token account info for decimals
      let sourceAccount;
      try {
        sourceAccount = await getAccount(connection, sourceAta);
      } catch {
        return NextResponse.json(
          { error: "You don't have this token" },
          { status: 400 }
        );
      }

      // Get token decimals from mint
      const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
      const decimals = (mintInfo.value?.data as { parsed: { info: { decimals: number } } }).parsed.info.decimals;
      const tokenAmount = BigInt(Math.floor(amountNum * Math.pow(10, decimals)));

      if (sourceAccount.amount < tokenAmount) {
        return NextResponse.json(
          { error: "Insufficient token balance" },
          { status: 400 }
        );
      }

      const transaction = new Transaction().add(
        createTransferInstruction(
          sourceAta,
          destAta,
          fromPubkey,
          tokenAmount,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromPubkey;

      transaction.sign(signer);
      signature = await connection.sendRawTransaction(transaction.serialize());
    }

    // Don't wait for full confirmation - just verify it was accepted
    // This prevents the UI from getting stuck if confirmation takes too long
    try {
      // Quick check that transaction was accepted (with short timeout)
      await Promise.race([
        connection.confirmTransaction(signature, "processed"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000))
      ]);
    } catch (e) {
      // Even if confirmation times out, transaction was sent successfully
      // User can check Solscan for final status
      console.log(`[withdraw] Confirmation timeout/error for ${signature}:`, e);
    }

    return NextResponse.json({
      success: true,
      txSignature: signature,
      explorerUrl: `https://solscan.io/tx/${signature}`,
    });
  } catch (error) {
    console.error("Withdraw error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Withdrawal failed" },
      { status: 500 }
    );
  } finally {
    // CRITICAL: Clear secret key from memory
    if (secretKey) {
      secretKey.fill(0);
    }
  }
}
