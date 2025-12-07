# Trading Implementation Plan - Polyx

## Executive Summary

Implement buy/sell functionality for Solana tokens (including Pulse/pump.fun tokens) using Jupiter aggregator for best prices. Users can trade directly from their custodial wallets stored in the database.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js)                        │
├─────────────────────────────────────────────────────────────────┤
│  Token Page → SwapWidget → Quote Preview → Confirm → Status     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     WEB API (Next.js API Routes)                 │
├─────────────────────────────────────────────────────────────────┤
│  /api/trading/quote     - Get swap quote from Jupiter           │
│  /api/trading/swap      - Execute swap (sign & send tx)         │
│  /api/trading/history   - User's trade history                  │
│  /api/trading/balance   - Get wallet SOL + token balances       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     JUPITER AGGREGATOR API                       │
├─────────────────────────────────────────────────────────────────┤
│  quote.jup.ag/v6/quote         - Best route quote               │
│  quote.jup.ag/v6/swap          - Build swap transaction         │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SOLANA BLOCKCHAIN                         │
├─────────────────────────────────────────────────────────────────┤
│  Sign with user's encrypted private key                         │
│  Send transaction via RPC                                        │
│  Confirm transaction                                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Database Schema

### New Models

```prisma
// Add to apps/web/prisma/schema.prisma

model Trade {
  id              String      @id @default(cuid())
  userId          String
  user            User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Token details
  tokenInMint     String      // Input token mint address
  tokenInSymbol   String      // e.g., "SOL"
  tokenOutMint    String      // Output token mint address
  tokenOutSymbol  String      // e.g., "BONK"

  // Amounts (stored as strings for precision)
  amountIn        String      // Amount of input token
  amountOut       String      // Amount of output token
  amountOutMin    String      // Minimum output (slippage protected)

  // Price info
  pricePerToken   Float       // Price per output token in input token
  priceImpact     Float       // Price impact percentage

  // Transaction
  txSignature     String?     @unique
  status          TradeStatus @default(PENDING)
  errorMessage    String?

  // Fees
  platformFee     String?     // Our fee in lamports
  networkFee      String?     // Network fee in lamports

  // Timestamps
  createdAt       DateTime    @default(now())
  confirmedAt     DateTime?

  @@index([userId, createdAt])
  @@index([txSignature])
  @@index([status])
}

enum TradeStatus {
  PENDING      // Quote generated, awaiting execution
  SUBMITTED    // Transaction submitted to network
  CONFIRMING   // Waiting for confirmation
  SUCCESS      // Trade completed
  FAILED       // Trade failed
  EXPIRED      // Quote expired before execution
}

// Add relation to User model
model User {
  // ... existing fields ...
  trades          Trade[]
}
```

---

## Phase 2: Backend API Routes

### File Structure

```
apps/web/src/app/api/trading/
├── quote/route.ts        # GET quote from Jupiter
├── swap/route.ts         # POST execute swap
├── history/route.ts      # GET user's trade history
├── balance/route.ts      # GET wallet balances
└── status/[txId]/route.ts # GET transaction status
```

### 2.1 Quote Endpoint

**File: `/api/trading/quote/route.ts`**

```typescript
// GET /api/trading/quote?inputMint=So11...&outputMint=Bonk...&amount=1000000000&slippage=50

interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  outAmountMin: string;      // After slippage
  priceImpactPct: number;
  routePlan: RoutePlan[];
  platformFee: string;
  expiresAt: number;         // Unix timestamp
}
```

### 2.2 Swap Endpoint

**File: `/api/trading/swap/route.ts`**

```typescript
// POST /api/trading/swap
// Body: { inputMint, outputMint, amount, slippage }

// Flow:
// 1. Verify user is authenticated
// 2. Get fresh quote from Jupiter
// 3. Get swap transaction from Jupiter
// 4. Decrypt user's private key
// 5. Sign transaction
// 6. Send to Solana RPC
// 7. Store trade in database
// 8. Return txSignature
```

### 2.3 Balance Endpoint

**File: `/api/trading/balance/route.ts`**

```typescript
// GET /api/trading/balance

interface BalanceResponse {
  sol: {
    balance: string;      // In lamports
    uiBalance: number;    // Human readable
    usdValue: number;
  };
  tokens: Array<{
    mint: string;
    symbol: string;
    name: string;
    balance: string;
    uiBalance: number;
    decimals: number;
    usdValue: number;
    logoUri?: string;
  }>;
}
```

---

## Phase 3: Jupiter Integration Service

**File: `apps/web/src/lib/jupiter.ts`**

```typescript
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";

const JUPITER_QUOTE_API = "https://quote-api.jup.ag/v6";

interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  priceImpactPct: string;
  routePlan: RoutePlanStep[];
  contextSlot: number;
  timeTaken: number;
}

export class JupiterService {
  private connection: Connection;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps: number;
    platformFeeBps?: number;
  }): Promise<JupiterQuote> {
    const url = new URL(`${JUPITER_QUOTE_API}/quote`);
    url.searchParams.set("inputMint", params.inputMint);
    url.searchParams.set("outputMint", params.outputMint);
    url.searchParams.set("amount", params.amount);
    url.searchParams.set("slippageBps", params.slippageBps.toString());
    url.searchParams.set("onlyDirectRoutes", "false");
    url.searchParams.set("asLegacyTransaction", "false");

    if (params.platformFeeBps) {
      url.searchParams.set("platformFeeBps", params.platformFeeBps.toString());
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Jupiter quote failed: ${response.statusText}`);
    }

    return response.json();
  }

  async getSwapTransaction(params: {
    quoteResponse: JupiterQuote;
    userPublicKey: string;
    wrapUnwrapSOL?: boolean;
    feeAccount?: string;
  }): Promise<VersionedTransaction> {
    const response = await fetch(`${JUPITER_QUOTE_API}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: params.quoteResponse,
        userPublicKey: params.userPublicKey,
        wrapAndUnwrapSol: params.wrapUnwrapSOL ?? true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    });

    if (!response.ok) {
      throw new Error(`Jupiter swap failed: ${response.statusText}`);
    }

    const { swapTransaction } = await response.json();
    const txBuffer = Buffer.from(swapTransaction, "base64");
    return VersionedTransaction.deserialize(txBuffer);
  }

  async executeSwap(
    transaction: VersionedTransaction,
    signerSecretKey: Uint8Array
  ): Promise<string> {
    const { Keypair } = await import("@solana/web3.js");
    const signer = Keypair.fromSecretKey(signerSecretKey);

    transaction.sign([signer]);

    const signature = await this.connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
    });

    // Wait for confirmation
    const confirmation = await this.connection.confirmTransaction(signature, "confirmed");

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    return signature;
  }
}
```

---

## Phase 4: Frontend Components

### File Structure

```
apps/web/src/components/trading/
├── SwapWidget.tsx        # Main swap interface
├── TokenSelector.tsx     # Token search/select modal
├── SwapPreview.tsx       # Quote preview with details
├── SwapConfirm.tsx       # Confirmation modal
├── SwapStatus.tsx        # Transaction status tracker
├── BalanceDisplay.tsx    # Wallet balance display
├── SlippageSettings.tsx  # Slippage tolerance selector
└── TradeHistory.tsx      # User's trade history
```

### 4.1 SwapWidget Component

```tsx
// apps/web/src/components/trading/SwapWidget.tsx

interface SwapWidgetProps {
  defaultInputMint?: string;   // Default to SOL
  defaultOutputMint?: string;  // Token page context
}

export function SwapWidget({ defaultInputMint, defaultOutputMint }: SwapWidgetProps) {
  const { data: session } = useSession();
  const [inputMint, setInputMint] = useState(defaultInputMint || SOL_MINT);
  const [outputMint, setOutputMint] = useState(defaultOutputMint);
  const [inputAmount, setInputAmount] = useState("");
  const [slippage, setSlippage] = useState(50); // 0.5% default
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch quote when inputs change
  useEffect(() => {
    const fetchQuote = async () => {
      if (!inputMint || !outputMint || !inputAmount) {
        setQuote(null);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(
          `/api/trading/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${toRawAmount(inputAmount)}&slippage=${slippage}`
        );
        const data = await res.json();
        setQuote(data);
      } catch (err) {
        console.error("Quote error:", err);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(fetchQuote, 300);
    return () => clearTimeout(debounce);
  }, [inputMint, outputMint, inputAmount, slippage]);

  const handleSwap = async () => {
    // Show confirmation modal
    // On confirm, call /api/trading/swap
    // Show status tracker
  };

  return (
    <div className="bg-[#1a1a1a] rounded-xl p-4 border border-white/10">
      {/* Input Token */}
      <TokenInput
        label="You pay"
        mint={inputMint}
        amount={inputAmount}
        onMintChange={setInputMint}
        onAmountChange={setInputAmount}
      />

      {/* Swap Direction Button */}
      <SwapDirectionButton onClick={handleFlip} />

      {/* Output Token */}
      <TokenInput
        label="You receive"
        mint={outputMint}
        amount={quote?.outAmount}
        onMintChange={setOutputMint}
        readOnly
      />

      {/* Quote Details */}
      {quote && <QuoteDetails quote={quote} />}

      {/* Slippage Settings */}
      <SlippageSettings value={slippage} onChange={setSlippage} />

      {/* Swap Button */}
      <SwapButton
        disabled={!quote || loading || !session}
        loading={loading}
        onClick={handleSwap}
      />
    </div>
  );
}
```

### 4.2 Integration into Token Page

```tsx
// Modify apps/web/src/app/token/[address]/page.tsx

// Add SwapWidget to the token page
<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
  {/* Chart takes 2 columns */}
  <div className="lg:col-span-2">
    <TokenChart token={token} />
  </div>

  {/* Swap widget takes 1 column */}
  <div className="lg:col-span-1">
    <SwapWidget
      defaultOutputMint={token.address}
      defaultInputMint={SOL_MINT}
    />
  </div>
</div>
```

---

## Phase 5: Security Measures

### 5.1 Rate Limiting

```typescript
// apps/web/src/lib/rateLimit.ts

const tradeLimits = new Map<string, { count: number; resetAt: number }>();

const TRADE_LIMITS = {
  FREE: { maxTrades: 5, windowMs: 60 * 1000 },     // 5 per minute
  PRO: { maxTrades: 30, windowMs: 60 * 1000 },    // 30 per minute
  BUSINESS: { maxTrades: 100, windowMs: 60 * 1000 }, // 100 per minute
};

export function checkTradeRateLimit(userId: string, plan: string): boolean {
  const limits = TRADE_LIMITS[plan] || TRADE_LIMITS.FREE;
  const now = Date.now();
  const record = tradeLimits.get(userId);

  if (!record || record.resetAt < now) {
    tradeLimits.set(userId, { count: 1, resetAt: now + limits.windowMs });
    return true;
  }

  if (record.count >= limits.maxTrades) {
    return false;
  }

  record.count++;
  return true;
}
```

### 5.2 Transaction Validation

```typescript
// Before executing any swap:
// 1. Verify user owns the wallet
// 2. Verify sufficient balance
// 3. Verify quote is fresh (< 30 seconds old)
// 4. Verify slippage is within acceptable range
// 5. Log all trade attempts for audit
```

### 5.3 Private Key Handling

```typescript
// CRITICAL: Private key handling rules
// 1. Never log private keys
// 2. Decrypt only when signing
// 3. Clear from memory immediately after use
// 4. Never send to frontend
// 5. Use try/finally to ensure cleanup

async function signTransaction(userId: string, tx: VersionedTransaction) {
  let secretKey: Uint8Array | null = null;

  try {
    // Decrypt private key
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletEncrypted: true },
    });

    if (!user?.walletEncrypted) {
      throw new Error("No wallet found");
    }

    const privateKeyBase58 = decryptPrivateKey(
      user.walletEncrypted,
      process.env.AUTH_SECRET!
    );

    secretKey = bs58.decode(privateKeyBase58);

    // Sign transaction
    const signer = Keypair.fromSecretKey(secretKey);
    tx.sign([signer]);

    return tx;
  } finally {
    // Clear secret key from memory
    if (secretKey) {
      secretKey.fill(0);
    }
  }
}
```

---

## Phase 6: Platform Fees (Optional)

### Fee Structure

```typescript
const PLATFORM_FEES = {
  FREE: 100,      // 1% fee (100 basis points)
  PRO: 50,        // 0.5% fee
  BUSINESS: 25,   // 0.25% fee
};

// Jupiter supports platform fees natively
// Set feeAccount in swap request
```

### Fee Collection Wallet

```env
# Add to .env
PLATFORM_FEE_WALLET=YourSolanaWalletAddress
```

---

## Phase 7: Implementation Order

### Week 1: Core Infrastructure
1. [ ] Add Trade model to Prisma schema
2. [ ] Create JupiterService class
3. [ ] Implement `/api/trading/quote` endpoint
4. [ ] Implement `/api/trading/balance` endpoint
5. [ ] Add Solana RPC configuration

### Week 2: Swap Execution
6. [ ] Implement `/api/trading/swap` endpoint
7. [ ] Add transaction signing logic
8. [ ] Implement `/api/trading/history` endpoint
9. [ ] Add rate limiting
10. [ ] Add error handling & retries

### Week 3: Frontend
11. [ ] Create SwapWidget component
12. [ ] Create TokenSelector modal
13. [ ] Create SwapConfirm modal
14. [ ] Create SwapStatus tracker
15. [ ] Integrate into token page

### Week 4: Polish & Testing
16. [ ] Add trade history UI
17. [ ] Add balance refresh
18. [ ] Test with devnet
19. [ ] Test with mainnet (small amounts)
20. [ ] Add analytics/logging

---

## Environment Variables Needed

```env
# Solana RPC
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
# Or use Helius/QuickNode for better reliability:
# SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Platform fee collection (optional)
PLATFORM_FEE_WALLET=YourSolanaWalletAddress
PLATFORM_FEE_BPS=50  # 0.5%

# Already have:
# AUTH_SECRET (for wallet decryption)
# DATABASE_URL
```

---

## API Endpoints Summary

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/trading/quote` | GET | No | Get swap quote |
| `/api/trading/swap` | POST | Yes | Execute swap |
| `/api/trading/balance` | GET | Yes | Get wallet balances |
| `/api/trading/history` | GET | Yes | Get trade history |
| `/api/trading/status/:tx` | GET | Yes | Get transaction status |

---

## Risk Considerations

### User Risks
- **Slippage**: Default 0.5%, allow up to 5%
- **Price Impact**: Warn if > 1%, block if > 10%
- **MEV**: Jupiter handles MEV protection

### Platform Risks
- **Key Security**: Encrypted at rest, decrypted only for signing
- **Rate Limits**: Prevent abuse
- **Audit Trail**: Log all trades

### Technical Risks
- **RPC Reliability**: Use fallback RPCs
- **Jupiter API**: Handle downtime gracefully
- **Transaction Failures**: Show clear errors, allow retry

---

## Success Metrics

- Trade execution success rate > 95%
- Average trade latency < 5 seconds
- User adoption: 10% of active users try trading
- Revenue from platform fees (if enabled)
