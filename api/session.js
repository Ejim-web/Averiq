// Simple in-memory session store (use database in production)
const sessions = {};

export default async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    // Check if session exists
    if (sessions[walletAddress] && sessions[walletAddress].active) {
      const session = sessions[walletAddress];
      const elapsed = Date.now() - session.startTime;

      if (elapsed < 86400000) {
        // 24 hours not complete
        const remaining = 86400000 - elapsed;
        return res.json({
          success: true,
          active: true,
          remaining: remaining,
          session: session
        });
      } else {
        // Session complete
        session.active = false;
        session.completed = true;
        return res.json({
          success: true,
          active: false,
          completed: true,
          session: session
        });
      }
    }

    // Start new session
    const newSession = {
      startTime: Date.now(),
      active: true,
      completed: false,
      wallet: walletAddress
    };

    sessions[walletAddress] = newSession;

    res.json({
      success: true,
      active: true,
      session: newSession
    });

  } else if (req.method === 'GET') {
    const { wallet } = req.query;

    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    const session = sessions[wallet];

    if (!session) {
      return res.json({
        success: true,
        active: false,
        completed: false
      });
    }

    const elapsed = Date.now() - session.startTime;
    const remaining = Math.max(0, 86400000 - elapsed);

    res.json({
      success: true,
      active: session.active,
      completed: session.completed || elapsed >= 86400000,
      remaining: remaining,
      session: session
    });

  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
