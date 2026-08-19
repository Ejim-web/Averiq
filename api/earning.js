const { Connection, PublicKey, Transaction, Keypair } = require('@solana/web3.js');
const { getMint, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createMintToInstruction } = require('@solana/spl-token');
const bs58 = require('bs58');

// ============================================================
// ENVIRONMENT VARIABLES (set in Vercel dashboard)
// ============================================================
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const AVQ_MINT_ADDRESS = process.env.AVQ_MINT_ADDRESS || 'Ff6oxq9jqbhyJTBre56KtXLCuUFKixa6v5EN2qCAXX36';
const REWARD_AMOUNT = parseInt(process.env.REWARD_AMOUNT) || 10;
const MINTER_SECRET_KEY = process.env.AVQ_MINTER_SECRET_KEY;

// ============================================================
// IN-MEMORY STORAGE (for demo - use Firebase in production)
// ============================================================
const sessions = {};

// ============================================================
// CORS HEADERS
// ============================================================
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ============================================================
// JSON RESPONSE HELPERS
// ============================================================
function sendJson(res, statusCode, data) {
  res.setHeader('Content-Type', 'application/json');
  res.status(statusCode).json(data);
}

function sendSuccess(res, data) {
  sendJson(res, 200, { success: true, ...data });
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { success: false, error: message });
}

// ============================================================
// VALIDATE WALLET
// ============================================================
function isValidWallet(address) {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// GET /api/earning?action=health
// ============================================================
function handleHealth(res) {
  sendSuccess(res, {
    action: 'health',
    status: 'online',
    timestamp: new Date().toISOString(),
    mint: AVQ_MINT_ADDRESS,
    reward: REWARD_AMOUNT,
    network: 'Solana Devnet'
  });
}

// ============================================================
// GET /api/earning?action=status&wallet=XXX
// ============================================================
function handleStatus(res, wallet) {
  if (!wallet) return sendError(res, 400, 'wallet parameter required');
  if (!isValidWallet(wallet)) return sendError(res, 400, 'Invalid wallet address');

  const session = sessions[wallet] || {};
  const now = Date.now();
  const duration = 86400000;

  let hasActiveSession = false;
  let sessionRemaining = 0;
  let sessionCompleted = false;

  if (session.startTime) {
    const elapsed = now - session.startTime;
    if (elapsed < duration) {
      hasActiveSession = true;
      sessionRemaining = duration - elapsed;
    } else {
      sessionCompleted = true;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const hasCheckedIn = session.lastCheckIn === today;

  sendSuccess(res, {
    action: 'status',
    wallet: wallet,
    hasActiveSession,
    sessionRemaining,
    sessionCompleted,
    hasCheckedIn,
    balance: session.balance || 0,
    claimable: session.claimable || 0,
    totalEarned: session.totalEarned || 0,
    totalClaimed: session.totalClaimed || 0,
    sessions: session.sessions || 0,
    streak: session.streak || 0,
    lastCheckIn: session.lastCheckIn || null
  });
}

// ============================================================
// POST /api/earning { action: 'start', wallet: '...' }
// ============================================================
function handleStart(res, wallet) {
  if (!wallet) return sendError(res, 400, 'wallet required');
  if (!isValidWallet(wallet)) return sendError(res, 400, 'Invalid wallet address');

  const now = Date.now();
  const duration = 86400000;

  if (sessions[wallet] && sessions[wallet].startTime) {
    const elapsed = now - sessions[wallet].startTime;
    if (elapsed < duration) {
      return sendError(res, 400, 'You already have an active earning session');
    }
  }

  sessions[wallet] = sessions[wallet] || {};
  sessions[wallet].startTime = now;
  sessions[wallet].duration = duration;
  sessions[wallet].sessions = (sessions[wallet].sessions || 0) + 1;

  sendSuccess(res, {
    action: 'start',
    wallet: wallet,
    message: '24-hour earning session started',
    startTime: now
  });
}

// ============================================================
// POST /api/earning { action: 'checkin', wallet: '...' }
// ============================================================
function handleCheckin(res, wallet) {
  if (!wallet) return sendError(res, 400, 'wallet required');
  if (!isValidWallet(wallet)) return sendError(res, 400, 'Invalid wallet address');

  const today = new Date().toISOString().slice(0, 10);
  const user = sessions[wallet] || {};

  if (user.lastCheckIn === today) {
    return sendError(res, 400, 'Already checked in today');
  }

  const reward = 0.25;
  user.lastCheckIn = today;
  user.checks = (user.checks || 0) + 1;
  user.streak = (user.streak || 0) + 1;
  user.balance = (user.balance || 0) + reward;
  user.claimable = (user.claimable || 0) + reward;
  user.totalEarned = (user.totalEarned || 0) + reward;

  sessions[wallet] = user;

  sendSuccess(res, {
    action: 'checkin',
    wallet: wallet,
    reward: reward,
    newBalance: user.balance,
    streak: user.streak,
    message: 'Daily check-in complete!'
  });
}

// ============================================================
// POST /api/earning { action: 'claim', wallet: '...' }
// ============================================================
async function handleClaim(res, wallet) {
  if (!wallet) return sendError(res, 400, 'wallet required');
  if (!isValidWallet(wallet)) return sendError(res, 400, 'Invalid wallet address');

  const user = sessions[wallet] || {};
  const now = Date.now();
  const duration = 86400000;

  // Check if session exists
  if (!user.startTime) {
    return sendError(res, 400, 'No earning session found. Start a session first.');
  }

  // Check if session is complete
  const elapsed = now - user.startTime;
  if (elapsed < duration) {
    const remaining = duration - elapsed;
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    return sendError(res, 400, `Session not complete. Wait ${hours}h ${minutes}m`);
  }

  if (user.claimed) {
    return sendError(res, 400, 'Reward already claimed for this session');
  }

  if (!user.claimable || user.claimable <= 0) {
    return sendError(res, 400, 'No rewards to claim');
  }

  // Check if minter key is available
  if (!MINTER_SECRET_KEY) {
    return sendError(res, 500, 'Minter key not configured. Set AVQ_MINTER_SECRET_KEY in environment.');
  }

  try {
    // Connect to Solana
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const mint = new PublicKey(AVQ_MINT_ADDRESS);
    const walletPubkey = new PublicKey(wallet);

    // Get minter keypair
    const secretKey = bs58.decode(MINTER_SECRET_KEY);
    const minter = Keypair.fromSecretKey(secretKey);

    // Get mint info
    const mintInfo = await getMint(connection, mint);
    if (!mintInfo.mintAuthority) {
      return sendError(res, 500, 'Mint has no authority');
    }

    // Get associated token account
    const tokenAccount = await getAssociatedTokenAddress(mint, walletPubkey);
    const transaction = new Transaction();

    // Create token account if needed
    const accountInfo = await connection.getAccountInfo(tokenAccount);
    if (!accountInfo) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          walletPubkey,
          tokenAccount,
          walletPubkey,
          mint
        )
      );
    }

    // Calculate reward amount
    const amount = user.claimable;
    const decimals = mintInfo.decimals || 9;
    const rawReward = BigInt(Math.floor(amount * (10 ** decimals)));

    // Add mint instruction
    transaction.add(
      createMintToInstruction(
        mint,
        tokenAccount,
        minter.publicKey,
        rawReward
      )
    );

    // Sign and send
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    transaction.feePayer = minter.publicKey;
    transaction.recentBlockhash = latestBlockhash.blockhash;
    transaction.sign(minter);

    const signature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction({
      signature: signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    }, 'confirmed');

    // Update user data
    const rewardAmount = Number(amount);
    user.balance = (user.balance || 0) + rewardAmount;
    user.totalClaimed = (user.totalClaimed || 0) + rewardAmount;
    user.claimable = 0;
    user.claimed = true;
    user.lastClaim = new Date().toISOString();

    sessions[wallet] = user;

    sendSuccess(res, {
      action: 'claim',
      wallet: wallet,
      amount: rewardAmount,
      transaction: signature,
      newBalance: user.balance,
      message: `Successfully claimed ${rewardAmount} AVQ`
    });

  } catch (error) {
    console.error('[AVQ] Claim error:', error);
    sendError(res, 500, 'Claim failed: ' + error.message);
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================
module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only GET and POST allowed
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendError(res, 405, `Method ${req.method} not allowed`);
  }

  try {
    let action;
    let wallet;

    if (req.method === 'GET') {
      action = req.query.action;
      wallet = req.query.wallet;
    } else {
      action = req.body?.action;
      wallet = req.body?.wallet;
    }

    if (!action) {
      return sendError(res, 400, 'Missing action parameter');
    }

    switch (action) {
      case 'health':
        handleHealth(res);
        break;

      case 'status':
        handleStatus(res, wallet);
        break;

      case 'start':
        await handleStart(res, wallet);
        break;

      case 'checkin':
        await handleCheckin(res, wallet);
        break;

      case 'claim':
        await handleClaim(res, wallet);
        break;

      default:
        sendError(res, 400, `Unknown action: ${action}`);
    }

  } catch (error) {
    console.error('[AVQ] Handler error:', error);
    sendError(res, 500, 'Internal error: ' + error.message);
  }
};
