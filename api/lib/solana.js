const {
    Connection,
    Keypair,
    PublicKey,
    clusterApiUrl
} = require("@solana/web3.js");

const {
    getAssociatedTokenAddress,
    getMint,
    getOrCreateAssociatedTokenAccount,
    mintTo
} = require("@solana/spl-token");

const bs58 = require("bs58");

function getConnection() {
    const rpc =
        process.env.SOLANA_RPC_URL ||
        clusterApiUrl("devnet");

    return new Connection(rpc, "confirmed");
}

function getMintAddress() {
    const value = process.env.AVQ_MINT;

    if (!value) {
        throw new Error("AVQ_MINT is not configured");
    }

    return new PublicKey(value);
}

function getMintAuthority() {
    const secret = process.env.MINT_AUTHORITY_SECRET_KEY;

    if (!secret) {
        throw new Error(
            "MINT_AUTHORITY_SECRET_KEY is not configured"
        );
    }

    let secretBytes;

    try {
        // Supports JSON array:
        // [1,2,3,...]
        if (secret.trim().startsWith("[")) {
            secretBytes = Uint8Array.from(JSON.parse(secret));
        } else {
            // Supports base58 private key
            secretBytes = bs58.decode(secret);
        }
    } catch {
        throw new Error(
            "MINT_AUTHORITY_SECRET_KEY is not valid"
        );
    }

    return Keypair.fromSecretKey(secretBytes);
}

async function verifyMintAuthority() {
    const connection = getConnection();
    const mint = getMintAddress();
    const authority = getMintAuthority();

    const mintInfo = await getMint(
        connection,
        mint,
        "confirmed"
    );

    if (!mintInfo.mintAuthority) {
        throw new Error(
            "This AVQ mint has no mint authority. New tokens cannot be minted."
        );
    }

    if (
        mintInfo.mintAuthority.toBase58() !==
        authority.publicKey.toBase58()
    ) {
        throw new Error(
            "The configured private key is NOT the mint authority for AVQ."
        );
    }

    return {
        mint,
        authority,
        decimals: mintInfo.decimals,
        supply: mintInfo.supply.toString()
    };
}

async function mintAVQ(walletAddress, amount) {
    const connection = getConnection();

    const recipient = new PublicKey(walletAddress);

    const {
        mint,
        authority,
        decimals
    } = await verifyMintAuthority();

    const destination =
        await getOrCreateAssociatedTokenAccount(
            connection,
            authority,
            mint,
            recipient
        );

    const rawAmount =
        BigInt(
            Math.round(
                amount * Math.pow(10, decimals)
            )
        );

    if (rawAmount <= 0n) {
        throw new Error("Invalid mint amount");
    }

    const signature = await mintTo(
        connection,
        authority,
        mint,
        destination.address,
        authority,
        rawAmount,
        [],
        {
            commitment: "confirmed"
        }
    );

    await connection.confirmTransaction(
        signature,
        "confirmed"
    );

    return {
        signature,
        destination: destination.address.toBase58(),
        amount,
        decimals
    };
}

module.exports = {
    getConnection,
    getMintAddress,
    verifyMintAuthority,
    mintAVQ
};
