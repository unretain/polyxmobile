/**
 * Encrypted seed-phrase vault (dedicated Supabase project).
 *
 * SECURITY MODEL:
 *  - Phrases are AES-256-GCM encrypted (encryptPrivateKey) with VAULT_ENCRYPTION_KEY
 *    BEFORE they ever touch the database. The DB only ever holds ciphertext.
 *  - VAULT_ENCRYPTION_KEY lives in env vars, NEVER in this database. A DB leak alone
 *    is therefore useless — an attacker would need the dump AND the key.
 *  - The Supabase SERVICE (secret) key is used server-side only. Never ship it to the
 *    client. This module must only be imported from server code (API routes).
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { encryptPrivateKey } from "./wallet";

const SUPABASE_URL = process.env.SUPABASE_VAULT_URL || "https://alakjyhcqweosagnlisn.supabase.co";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_VAULT_SECRET_KEY || "";
const VAULT_ENCRYPTION_KEY = process.env.VAULT_ENCRYPTION_KEY || "";

let client: SupabaseClient | null = null;
function vault(): SupabaseClient | null {
  if (!SUPABASE_SECRET_KEY || !VAULT_ENCRYPTION_KEY) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function vaultConfigured(): boolean {
  return !!SUPABASE_SECRET_KEY && !!VAULT_ENCRYPTION_KEY;
}

/**
 * Store (or update) a user's seed phrase, encrypted. Keyed by wallet public key.
 * Returns { ok } — never throws to the caller, never logs the plaintext.
 */
export type WalletPlatform = "mobile" | "web";

// Seed phrases are split by where the wallet was created:
//   mobile_wallets (the mobile app)  |  web_wallets (the website)
function tableFor(platform: WalletPlatform): string {
  return platform === "web" ? "web_wallets" : "mobile_wallets";
}

export async function storeSeedPhrase(
  publicKey: string,
  mnemonic: string,
  platform: WalletPlatform = "mobile"
): Promise<{ ok: boolean; error?: string }> {
  const c = vault();
  if (!c) return { ok: false, error: "vault not configured (missing env vars)" };
  try {
    const mnemonic_encrypted = encryptPrivateKey(mnemonic, VAULT_ENCRYPTION_KEY);
    const { error } = await c
      .from(tableFor(platform))
      .upsert(
        { public_key: publicKey, mnemonic_encrypted },
        { onConflict: "public_key" }
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "encrypt/store failed" };
  }
}
