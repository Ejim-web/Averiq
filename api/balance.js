import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, getAssociatedTokenAddress, getAccount } from '@solana/spl-token';

const AVQ_MINT_ADDRESS = "Ff6oxq9jqbhyJTBre56KtXLCuUFKixa6v5EN2qCAXX36";
const DEVNET_RPC = "https://api.devnet.solana.com";

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { wallet } = req.query;

  if (!wallet) {
    return res.status(400).json({ error: 'Wallet address required' });
  }

  try {
    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const mint = new PublicKey(AVQ_MINT_ADDRESS);
    const walletPubkey = new PublicKey(wallet);

    const mintInfo = await getMint(connection, mint);
    const tokenAccount = await getAssociatedTokenAddress(mint, walletPubkey);

    let rawAmount = 0n;
    try {
      const account = await getAccount(connection, tokenAccount);
      rawAmount = BigInt(account.amount);
    } catch {
      // No token account exists, balance is 0
    }

    const divisor = 10n ** BigInt(mintInfo.decimals);
    const whole = rawAmount / divisor;
    const fraction = rawAmount % divisor;

    let balance = whole.toString();
    if (fraction > 0n) {
      const fractionText = fraction.toString().padStart(mintInfo.decimals, '0').replace(/0+$/, '');
      balance = whole.toString() + '.' + fractionText;
    }

    res.json({
      success: true,
      balance: balance,
      decimals: mintInfo.decimals,
      mint: AVQ_MINT_ADDRESS,
      tokenAccount: tokenAccount.toBase58()
    });

  } catch (error) {
    console.error('[AVQ] Balance error:', error);
    res.status(500).json({
      error: 'Failed to get balance: ' + error.message
    });
  }
}
