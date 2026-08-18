const crypto = require("crypto");
const { getDb } = require("../lib/firebase");
const { requireAuth } = require("../lib/auth");

const SESSION_LENGTH_MS =
    24 * 60 * 60 * 1000;

const SESSION_REWARD = 10;

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const auth = requireAuth(req);
        const wallet = auth.wallet;

        const db = getDb();

        const userRef = db
            .collection("averiq_users")
            .doc(wallet);

        const sessionId =
            crypto.randomUUID();

        const sessionRef = db
            .collection("averiq_sessions")
            .doc(sessionId);

        const now = Date.now();

        const startedAt = new Date(now);
        const endsAt = new Date(
            now + SESSION_LENGTH_MS
        );

        await db.runTransaction(
            async transaction => {
                const userSnapshot =
                    await transaction.get(userRef);

                const user =
                    userSnapshot.exists
                        ? userSnapshot.data()
                        : {};

                if (user.activeSessionId) {
                    const oldRef =
                        db.collection(
                            "averiq_sessions"
                        ).doc(
                            user.activeSessionId
                        );

                    const oldSnapshot =
                        await transaction.get(
                            oldRef
                        );

                    if (oldSnapshot.exists) {
                        const old =
                            oldSnapshot.data();

                        if (
                            old.status === "running" ||
                            old.status === "completed"
                        ) {
                            throw new Error(
                                "You already have an active or unclaimed session."
                            );
                        }
                    }
                }

                transaction.set(
                    sessionRef,
                    {
                        wallet,
                        status: "running",
                        startedAt,
                        endsAt,
                        reward: SESSION_REWARD,
                        claimTransaction: null,
                        createdAt: startedAt
                    }
                );

                transaction.set(
                    userRef,
                    {
                        wallet,
                        activeSessionId: sessionId,
                        updatedAt: startedAt
                    },
                    {
                        merge: true
                    }
                );
            }
        );

        return res.status(200).json({
            success: true,
            sessionId,
            startedAt: startedAt.toISOString(),
            endsAt: endsAt.toISOString(),
            reward: SESSION_REWARD
        });

    } catch (error) {
        console.error(error);

        return res.status(400).json({
            error: error.message ||
                "Could not start earning session"
        });
    }
};
