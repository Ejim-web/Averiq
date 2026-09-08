// api/earning.js
const admin = require('firebase-admin');
const { getAVQBalance, transferAVQ } = require('./lib/ethereum');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}

const db = admin.firestore();

// Get user earnings
async function getUserEarnings(userId) {
    try {
        const doc = await db.collection('users').doc(userId).get();
        if (!doc.exists) {
            return { balance: 0, claimable: 0, mined: 0 };
        }
        return doc.data();
    } catch (error) {
        console.error("Error getting user earnings:", error);
        return null;
    }
}

// Update user earnings
async function updateUserEarnings(userId, data) {
    try {
        await db.collection('users').doc(userId).set(data, { merge: true });
        return true;
    } catch (error) {
        console.error("Error updating user earnings:", error);
        return false;
    }
}

// Claim AVQ rewards
async function claimRewards(userId, walletAddress) {
    try {
        const userData = await getUserEarnings(userId);
        if (!userData || userData.claimable <= 0) {
            return { success: false, error: "No claimable rewards" };
        }

        // Get on-chain balance to verify
        const onChainBalance = await getAVQBalance(walletAddress);
        
        // In production, you would mint or transfer tokens here
        // For now, just update the database
        
        const claimAmount = userData.claimable;
        await updateUserEarnings(userId, {
            claimable: 0,
            totalClaimed: admin.firestore.FieldValue.increment(claimAmount),
            lastClaim: new Date().toISOString()
        });

        return {
            success: true,
            amount: claimAmount,
            onChainBalance: onChainBalance
        };
    } catch (error) {
        console.error("Claim rewards error:", error);
        return { success: false, error: error.message };
    }
}

// Add mining rewards
async function addMiningReward(userId, amount) {
    try {
        await updateUserEarnings(userId, {
            balance: admin.firestore.FieldValue.increment(amount),
            claimable: admin.firestore.FieldValue.increment(amount),
            mined: admin.firestore.FieldValue.increment(amount),
            lastMined: new Date().toISOString()
        });
        return true;
    } catch (error) {
        console.error("Add mining reward error:", error);
        return false;
    }
}

module.exports = {
    getUserEarnings,
    updateUserEarnings,
    claimRewards,
    addMiningReward
};
