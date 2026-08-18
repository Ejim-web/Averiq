const crypto = require("crypto");
const { PublicKey } = require("@solana/web3.js");
const { getDb } = require("../lib/firebase");

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const { wallet } = req.body || {};

        if (!wallet) {
            return res.status(400).json({
                error: "Wallet address is required"
            });
        }

        let publicKey;

        try {
            publicKey = new PublicKey(wallet);
        } catch {
            return res.status(400).json({
                error: "Invalid Solana wallet address"
            });
        }

        const walletAddress = publicKey.toBase58();

        const nonce = crypto.randomBytes(32).toString("hex");

        const issuedAt = new Date();
        const expiresAt = new Date(
            issuedAt.getTime() + 5 * 60 * 1000
        );

        const message =
`Averiq wants you to sign in with your Solana account:

${walletAddress}

Sign this message to prove you control this wallet.
This signature does not authorize a blockchain transaction.

Network: Solana Devnet
Nonce: ${nonce}
Issued At: ${issuedAt.toISOString()}
Expiration Time: ${expiresAt.toISOString()}`;

        const db = getDb();

        await db
            .collection("averiq_auth_challenges")
            .doc(walletAddress)
            .set({
                wallet: walletAddress,
                nonce,
                message,
                issuedAt,
                expiresAt,
                used: false
            });

        return res.status(200).json({
            wallet: walletAddress,
            message,
            expiresAt: expiresAt.toISOString()
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            error: "Could not create authentication challenge"
        });
    }
};
