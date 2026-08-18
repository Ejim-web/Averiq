const jwt = require("jsonwebtoken");

function getTokenFromRequest(req) {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
        throw new Error("Missing authorization token");
    }

    return header.slice(7);
}

function requireAuth(req) {
    const token = getTokenFromRequest(req);

    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not configured");
    }

    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        throw new Error("Invalid or expired authorization token");
    }
}

function createToken(wallet) {
    return jwt.sign(
        {
            wallet,
            network: "solana-devnet"
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "7d",
            issuer: "averiq"
        }
    );
}

module.exports = {
    requireAuth,
    createToken
};
