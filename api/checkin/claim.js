const { getDb } = require("../lib/firebase");
const { requireAuth } = require("../lib/auth");
const { mintAVQ } = require("../lib/solana");

const CHECKIN_REWARD = 0.25;

function getUtcDay() {
    return new Date()
        .toISOString()
        .slice(0, 10);
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const auth = requireAuth(req);
        const wallet = auth.wallet;
        const day = getUtcDay();

        const db = getDb();

        const checkinRef =
            db.collection("averiq_checkins")
                .doc(`${wallet}_${day}`);

        let shouldMint = false;

        await db.runTransaction(
            async transaction => {
                const snapshot =
                    await transaction.get(
                        checkinRef
                    );

                if (snapshot.exists) {
                    throw new Error(
                        "Already checked in today"
                    );
                }

                transaction.create(
                    checkinRef,
                    {
                        wallet,
                        day,
                        amount: CHECKIN_REWARD,
                        status: "processing",
                        createdAt: new Date()
                    }
                );

                shouldMint = true;
            }
        );

        if (!shouldMint) {
            throw new Error(
                "Check-in could not be processed"
            );
        }

        const result =
            await mintAVQ(
                wallet,
                CHECKIN_REWARD
            );

        await checkinRef.update({
            status: "claimed",
            transaction:
                result.signature,
            claimedAt: new Date()
        });

        return res.status(200).json({
            success: true,
            amount: CHECKIN_REWARD,
            transaction:
                result.signature,
            explorer:
                `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`
        });

    } catch (error) {
        console.error(error);

        return res.status(400).json({
            error:
                error.message ||
                "Check-in failed"
        });
    }
};
