import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { getMint, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createMintToInstruction } from '@solana/spl-token';

const AVQ_MINT_ADDRESS = "Ff6oxq9jqbhyJTBre56KtXLCuUFKixa6v5EN2qCAXX36";
const DEVNET_RPC = "https://api.devnet.solana.com";
const REWARD_AMOUNT = 10;

export default async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { walletAddress, sessionId } = req.body;

  if (!walletAddress) {
    return res.status(400).json({ error: 'Wallet address required' });
  }

  try {
    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const mint = new PublicKey(AVQ_MINT_ADDRESS);
    const wallet = new PublicKey(walletAddress);

    // Get mint info to check authority
    const mintInfo = await getMint(connection, mint);

    if (!mintInfo.mintAuthority) {
      return res.status(400).json({ error: 'Mint has no authority' });
    }

    // Check if connected wallet is the mint authority
    if (!mintInfo.mintAuthority.equals(wallet)) {
      return res.status(403).json({
        error: 'This wallet is not the mint authority',
        mintAuthority: mintInfo.mintAuthority.toBase58()
      });
    }

    // Get associated token account
    const tokenAccount = await getAssociatedTokenAddress(mint, wallet);

    // Build transaction
    const transaction = new Transaction();

    const accountInfo = await connection.getAccountInfo(tokenAccount);
    if (!accountInfo) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          wallet,
          tokenAccount,
          wallet,
          mint
        )
      );
    }

    const rawReward = BigInt(REWARD_AMOUNT) * (10n ** BigInt(mintInfo.decimals));
    transaction.add(
      createMintToInstruction(
        mint,
        tokenAccount,
        wallet,
        rawReward
      )
    );

    transaction.feePayer = wallet;
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = latestBlockhash.blockhash;

    // Return transaction to be signed by client
    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    });

    res.json({
      success: true,
      transaction: serialized.toString('base64'),
      message: 'Transaction ready for signing',
      amount: REWARD_AMOUNT
    });

  } catch (error) {
    console.error('[AVQ] Claim error:', error);
    res.status(500).json({
      error: 'Claim failed: ' + error.message
    });
  }
}
