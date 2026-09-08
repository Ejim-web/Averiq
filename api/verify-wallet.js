// api/verify-wallet.js
const { getAVQBalance, getNetworkInfo } = require('./lib/ethereum');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { walletAddress } = req.body;

        if (!walletAddress) {
            return res.status(400).json({ error: 'Wallet address required' });
        }

        // Get network info
        const networkInfo = await getNetworkInfo();
        
        // Get AVQ balance
        const balance = await getAVQBalance(walletAddress);

        return res.status(200).json({
            success: true,
            walletAddress,
            balance,
            network: networkInfo
        });

    } catch (error) {
        console.error("Verify wallet error:", error);
        return res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};
