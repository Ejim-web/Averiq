export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { walletAddress } = req.body;

  if (!walletAddress) {
    return res.status(400).json({ error: 'Wallet address required' });
  }

  console.log('[AVQ] Wallet connected:', walletAddress);

  // In production, save to database here
  // For now, we just return success

  res.json({
    success: true,
    message: 'Wallet connected successfully',
    wallet: walletAddress,
    sessionId: Date.now().toString()
  });
}
