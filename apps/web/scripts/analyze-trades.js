// Analyze trades with fees - using nativeBalanceChange for accuracy
const walletAddress = 'AnQoSxGdSd7q48b75ygSwNpM4VdN5fdJNVxtPQKJHfCe';
const apiKey = process.env.SOLANA_RPC_URL?.match(/api-key=([a-f0-9-]+)/i)?.[1];

if (!apiKey) {
  console.error('Need SOLANA_RPC_URL with Helius API key');
  process.exit(1);
}

async function main() {
  const url = `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${apiKey}`;
  const res = await fetch(url);
  const txs = await res.json();

  console.log('=== FULL TRANSACTION ANALYSIS (using nativeBalanceChange) ===\n');

  let totalNetChange = 0;

  for (const tx of txs) {
    if (tx.type !== 'SWAP' && tx.type !== 'SWAP_WSOL') continue;

    const tokenTransfers = tx.tokenTransfers || [];
    const accountData = tx.accountData || [];

    // Get TRUE net SOL change from accountData (includes fees!)
    const walletAccountData = accountData.find(a => a.account === walletAddress);
    const netSolChange = walletAccountData?.nativeBalanceChange || 0;

    // Check if we received or sent tokens
    let tokenIn = 0, tokenOut = 0;
    for (const t of tokenTransfers) {
      if (t.mint === 'So11111111111111111111111111111111111111112') continue;
      if (t.toUserAccount === walletAddress) tokenIn += t.tokenAmount;
      if (t.fromUserAccount === walletAddress) tokenOut += t.tokenAmount;
    }

    const isBuy = tokenIn > tokenOut;
    const tokenNet = tokenIn - tokenOut;

    console.log('Tx:', tx.signature.slice(0,20) + '...');
    console.log('  Type:', isBuy ? 'BUY' : 'SELL');
    console.log('  Net SOL change:', (netSolChange/1e9).toFixed(9), 'SOL', netSolChange > 0 ? '(received)' : '(spent)');
    console.log('  Tokens:', tokenNet > 0 ? '+' + tokenNet.toFixed(2) : tokenNet.toFixed(2));
    console.log('  Fee:', (tx.fee/1e9).toFixed(9), 'SOL');
    console.log('');

    totalNetChange += netSolChange;
  }

  console.log('=== SUMMARY ===');
  console.log('Total net SOL change (all swaps):', (totalNetChange/1e9).toFixed(9), 'SOL');
  console.log('');
  if (totalNetChange > 0) {
    console.log('PROFIT:', (totalNetChange/1e9).toFixed(9), 'SOL');
  } else {
    console.log('LOSS:', (Math.abs(totalNetChange)/1e9).toFixed(9), 'SOL');
  }
}

main().catch(console.error);
