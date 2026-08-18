const crypto = require("crypto");
const { getDb } = require("../lib/firebase");
const { requireAuth } = require("../lib/auth");
const { mintAVQ } = require("../lib/solana");

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    let sessionId;
    let wallet;
    let claimLockId;

    try {
        const auth = requireAuth(req);

        wallet = auth.wallet;
        sessionId =
            req.body?.sessionId;

        if (!sessionId) {
            return res.status(400).json({
                error: "sessionId is required"
            });
        }

        const db = getDb();

        const sessionRef =
            db.collection(
                "averiq_sessions"
            ).doc(sessionId);

        claimLockId =
            crypto.randomUUID();

        await db.runTransaction(
            async transaction => {
                const snapshot =
                    await transaction.get(
                        sessionRef
                    );

                if (!snapshot.exists) {
                    throw new Error(
                        "Earning session not found"
                    );
                }

                const session =
                    snapshot.data();

                if (session.wallet !== wallet) {
                    throw new Error(
                        "This session does not belong to this wallet"
                    );
                }

                if (
                    session.status === "claimed"
                ) {
                    throw new Error(
                        "This reward has already been claimed"
                    );
                }

                if (
                    session.status === "claiming"
                ) {
                    throw new Error(
                        "A claim is already being processed"
                    );
                }

                if (
                    session.status !== "running" &&
                    session.status !== "completed"
                ) {
                    throw new Error(
                        "Invalid session status"
                    );
                }

                const endsAt =
                    session.endsAt.toDate();

                if (
                    Date.now() <
                    endsAt.getTime()
                ) {
                    const remaining =
                        endsAt.getTime() -
                        Date.now();

                    const hours =
                        Math.ceil(
                            remaining /
                            3600000
                        );

                    throw new Error(
                        `Session is not complete. Approximately ${hours} hour(s) remaining.`
                    );
                }

                transaction.update(
                    sessionRef,
                    {
                        status: "claiming",
                        claimLockId,
                        completedAt:
                            new Date()
                    }
                );
            }
        );

        /*
         * The transaction above has locked the session.
         * Only now do we perform the blockchain mint.
         */

        const result =
            await mintAVQ(
                wallet,
                10
            );

        await db
            .collection("averiq_sessions")
            .doc(sessionId)
            .update({
                status: "claimed",
                claimTransaction:
                    result.signature,
                claimAmount: 10,
                claimedAt: new Date(),
                claimLockId: null
            });

        await db
            .collection("averiq_users")
            .doc(wallet)
            .set(
                {
                    wallet,
                    totalClaimed: 10,
                    lastClaimTransaction:
                        result.signature,
                    updatedAt: new Date()
                },
                {
                    merge: true
                }
            );

        return res.status(200).json({
            success: true,
            amount: 10,
            transaction:
                result.signature,
            mint:
                process.env.AVQ_MINT,
            explorer:
                `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`
        });

    } catch (error) {
        console.error(error);

        /*
         * If minting failed after the lock,
         * return the session to completed so the
         * user can safely retry.
         */
        if (
            sessionId &&
            claimLockId &&
            wallet
        ) {
            try {
                const db = getDb();

                const sessionRef =
                    db.collection(
                        "averiq_sessions"
                    ).doc(sessionId);

                await db.runTransaction(
                    async transaction => {
                        const snapshot =
                            await transaction.get(
                                sessionRef
                            );

                        if (!snapshot.exists) {
                            return;
                        }

                        const session =
                            snapshot.data();

                        if (
                            session.status ===
                                "claiming" &&
                            session.claimLockId ===
                                claimLockId
                        ) {
                            transaction.update(
                                sessionRef,
                                {
                                    status:
                                        "completed",
                                    claimLockId:
                                        null,
                                    lastClaimError:
                                        String(
                                            error.message ||
                                                error
                                        )
                                }
                            );
                        }
                    }
                );
            } catch (recoveryError) {
                console.error(
                    "Recovery failed:",
                    recoveryError
                );
            }
        }

        return res.status(400).json({
            error:
                error.message ||
                "Reward claim failed"
        });
    }
};
