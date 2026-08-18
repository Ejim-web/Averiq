const { PublicKey } = require("@solana/web3.js");
const nacl = require("tweetnacl");
const bs58 = require("bs58");
const { getDb } = require("../lib/firebase");
const { createToken } = require("../lib/auth");

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const {
            wallet,
            signature
        } = req.body || {};

        if (!wallet || !signature) {
            return res.status(400).json({
                error: "Wallet and signature are required"
            });
        }

        let publicKey;

        try {
            publicKey = new PublicKey(wallet);
        } catch {
            return res.status(400).json({
                error: "Invalid wallet address"
            });
        }

        const walletAddress = publicKey.toBase58();

        const db = getDb();

        const ref = db
            .collection("averiq_auth_challenges")
            .doc(walletAddress);

        let challenge;

        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);

            if (!snapshot.exists) {
                throw new Error("Authentication challenge not found");
            }

            const data = snapshot.data();

            if (data.used) {
                throw new Error("Authentication challenge already used");
            }

            if (
                !data.expiresAt ||
                data.expiresAt.toDate().getTime() <
                    Date.now()
            ) {
                throw new Error("Authentication challenge expired");
            }

            challenge = data;

            transaction.update(ref, {
                used: true
            });
        });

        const messageBytes =
            new TextEncoder().encode(
                challenge.message
            );

        let signatureBytes;

        try {
            signatureBytes = bs58.decode(signature);
        } catch {
            return res.status(400).json({
                error: "Invalid signature encoding"
            });
        }

        const valid =
            nacl.sign.detached.verify(
                messageBytes,
                signatureBytes,
                publicKey.toBytes()
            );

        if (!valid) {
            return res.status(401).json({
                error: "Wallet signature verification failed"
            });
        }

        const token = createToken(walletAddress);

        return res.status(200).json({
            success: true,
            token,
            wallet: walletAddress,
            expiresIn: "7d"
        });

    } catch (error) {
        console.error(error);

        return res.status(401).json({
            error: error.message ||
                "Authentication failed"
        });
    }
};
