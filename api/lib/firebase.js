const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function getDb() {
    if (!getApps().length) {
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

        if (!raw) {
            throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
        }

        const serviceAccount = JSON.parse(raw);

        initializeApp({
            credential: cert(serviceAccount)
        });
    }

    return getFirestore();
}

module.exports = { getDb };
