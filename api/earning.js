// api/earning.js
// ============================================================
// AVERIQ - SECURE SOLANA AVQ EARNING API
// Vercel Node.js Function
// ============================================================

const {
  Connection,
  PublicKey,
  Keypair,
} = require("@solana/web3.js");

const {
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} = require("@solana/spl-token");

const admin = require("firebase-admin");

// ============================================================
// CONFIG
// ============================================================

const RPC_URL =
  process.env.SOLANA_RPC_URL ||
  "https://api.devnet.solana.com";

const AVQ_MINT_ADDRESS =
  process.env.AVQ_MINT_ADDRESS ||
  "Ff6oxq9jqbhyJTBre56KtXLCuUFKixa6v5EN2qCAXX36";

const REWARD_AMOUNT =
  Number(process.env.REWARD_AMOUNT || "10");

const CHECKIN_REWARD =
  Number(process.env.CHECKIN_REWARD || "0.25");

const SESSION_LENGTH_MS =
  24 * 60 * 60 * 1000;

const MAX_REWARD_AMOUNT =
  1000000;

// ============================================================
// FIREBASE
// ============================================================

let db = null;

function getDatabase() {
  if (db) {
    return db;
  }

  if (!process.env.FIREBASE_PROJECT_ID) {
    throw new Error("Missing FIREBASE_PROJECT_ID.");
  }

  if (!process.env.FIREBASE_CLIENT_EMAIL) {
    throw new Error("Missing FIREBASE_CLIENT_EMAIL.");
  }

  if (!process.env.FIREBASE_PRIVATE_KEY) {
    throw new Error("Missing FIREBASE_PRIVATE_KEY.");
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:
          process.env.FIREBASE_PROJECT_ID,

        clientEmail:
          process.env.FIREBASE_CLIENT_EMAIL,

        privateKey:
          process.env.FIREBASE_PRIVATE_KEY
            .replace(/\\n/g, "\n"),
      }),
    });
  }

  db = admin.firestore();

  return db;
}

// ============================================================
// SOLANA
// ============================================================

const connection =
  new Connection(
    RPC_URL,
    "confirmed"
  );

// ============================================================
// JSON RESPONSE
// ============================================================

function sendJSON(
  res,
  status,
  data
) {
  if (res.headersSent) {
    return;
  }

  res.statusCode = status;

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );

  res.end(
    JSON.stringify(data)
  );
}

function sendError(
  res,
  status,
  message
) {
  return sendJSON(
    res,
    status,
    {
      success: false,
      error: message,
    }
  );
}

// ============================================================
// BODY PARSER
// ============================================================

async function getBody(req) {
  if (req.body !== undefined) {
    if (
      typeof req.body === "object" &&
      req.body !== null
    ) {
      return req.body;
    }

    if (
      typeof req.body === "string"
    ) {
      if (!req.body.trim()) {
        return {};
      }

      try {
        return JSON.parse(req.body);
      } catch {
        throw new Error(
          "Invalid JSON request body."
        );
      }
    }
  }

  return new Promise(
    (resolve, reject) => {
      let raw = "";

      req.on(
        "data",
        chunk => {
          raw += chunk.toString();

          if (raw.length > 1024 * 1024) {
            reject(
              new Error(
                "Request body is too large."
              )
            );

            req.destroy();
          }
        }
      );

      req.on(
        "end",
        () => {
          if (!raw.trim()) {
            resolve({});
            return;
          }

          try {
            resolve(
              JSON.parse(raw)
            );
          } catch {
            reject(
              new Error(
                "Invalid JSON request body."
              )
            );
          }
        }
      );

      req.on(
        "error",
        reject
      );
    }
  );
}

// ============================================================
// WALLET VALIDATION
// ============================================================

function getWallet(wallet) {
  if (
    typeof wallet !== "string" ||
    !wallet.trim()
  ) {
    throw new Error(
      "Wallet address is required."
    );
  }

  try {
    return new PublicKey(
      wallet.trim()
    );
  } catch {
    throw new Error(
      "Invalid Solana wallet address."
    );
  }
}

// ============================================================
// MINTER KEY
// ============================================================

function getMinter() {
  const value =
    process.env.AVQ_MINTER_SECRET_KEY;

  if (!value) {
    throw new Error(
      "AVQ_MINTER_SECRET_KEY is not configured."
    );
  }

  let secret;

  try {
    secret = JSON.parse(value);
  } catch {
    throw new Error(
      "AVQ_MINTER_SECRET_KEY must be a JSON array."
    );
  }

  if (
    !Array.isArray(secret) ||
    secret.length !== 64
  ) {
    throw new Error(
      "AVQ_MINTER_SECRET_KEY must contain exactly 64 secret-key bytes."
    );
  }

  try {
    return Keypair.fromSecretKey(
      Uint8Array.from(secret)
    );
  } catch {
    throw new Error(
      "AVQ mint authority secret key is invalid."
    );
  }
}

// ============================================================
// MINT
// ============================================================

async function getAVQMint() {
  const mintAddress =
    new PublicKey(
      AVQ_MINT_ADDRESS
    );

  return getMint(
    connection,
    mintAddress
  );
}

// ============================================================
// FIRESTORE REFERENCES
// ============================================================

function sessionRef(wallet) {
  return getDatabase()
    .collection(
      "averiq_earning_sessions"
    )
    .doc(wallet);
}

function checkinRef(wallet) {
  return getDatabase()
    .collection(
      "averiq_checkins"
    )
    .doc(wallet);
}

// ============================================================
// GET SESSION
// ============================================================

async function readSession(wallet) {
  const snap =
    await sessionRef(wallet).get();

  if (!snap.exists) {
    return null;
  }

  return snap.data();
}

// ============================================================
// START
// ============================================================

async function startEarning(
  res,
  wallet
) {
  const now =
    Date.now();

  const existing =
    await readSession(wallet);

  if (existing) {
    const end =
      Number(
        existing.sessionEnd || 0
      );

    if (
      existing.status === "active" &&
      end > now
    ) {
      return sendJSON(
        res,
        200,
        {
          success: true,
          alreadyRunning: true,
          sessionEnd: end,
          sessionCompleted: false,
          rewardAmount:
            Number(
              existing.rewardAmount ||
              REWARD_AMOUNT
            ),
        }
      );
    }

    if (
      (
        existing.status === "completed" ||
        existing.status === "claiming"
      ) &&
      !existing.claimed
    ) {
      return sendJSON(
        res,
        409,
        {
          success: false,
          error:
            "Your previous session is ready to claim.",
          sessionEnd: null,
          sessionCompleted: true,
        }
      );
    }
  }

  const sessionEnd =
    now +
    SESSION_LENGTH_MS;

  await sessionRef(wallet).set(
    {
      wallet,
      status: "active",
      startedAt: now,
      sessionEnd,
      claimed: false,
      rewardAmount:
        REWARD_AMOUNT,
      updatedAt: now,
    },
    {
      merge: true,
    }
  );

  return sendJSON(
    res,
    200,
    {
      success: true,
      action: "start",
      wallet,
      sessionEnd,
      sessionCompleted: false,
      rewardAmount:
        REWARD_AMOUNT,
      message:
        "24-hour earning session started.",
    }
  );
}

// ============================================================
// STATUS
// ============================================================

async function getStatus(
  res,
  wallet
) {
  const session =
    await readSession(wallet);

  if (!session) {
    return sendJSON(
      res,
      200,
      {
        success: true,
        wallet,
        sessionEnd: null,
        sessionCompleted: false,
        claimed: false,
        rewardAmount:
          REWARD_AMOUNT,
      }
    );
  }

  const now =
    Date.now();

  const end =
    Number(
      session.sessionEnd || 0
    );

  let completed =
    session.status ===
      "completed" ||
    session.status ===
      "claiming";

  if (
    session.status === "active" &&
    end > 0 &&
    end <= now
  ) {
    await sessionRef(wallet).set(
      {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      },
      {
        merge: true,
      }
    );

    completed = true;
  }

  return sendJSON(
    res,
    200,
    {
      success: true,
      wallet,
      sessionEnd:
        completed
          ? null
          : end || null,
      sessionCompleted:
        completed,
      claimed:
        Boolean(
          session.claimed
        ),
      rewardAmount:
        Number(
          session.rewardAmount ||
          REWARD_AMOUNT
        ),
    }
  );
}

// ============================================================
// ACTUAL ON-CHAIN MINT
// ============================================================

async function mintAVQ(
  wallet,
  amount
) {
  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Invalid reward amount."
    );
  }

  if (
    amount >
    MAX_REWARD_AMOUNT
  ) {
    throw new Error(
      "Reward amount exceeds server limit."
    );
  }

  const recipient =
    getWallet(wallet);

  const minter =
    getMinter();

  const mint =
    await getAVQMint();

  if (!mint.mintAuthority) {
    throw new Error(
      "AVQ mint has no mint authority."
    );
  }

  if (
    !mint.mintAuthority.equals(
      minter.publicKey
    )
  ) {
    throw new Error(
      "The server wallet is not the AVQ mint authority."
    );
  }

  const tokenAccount =
    await getOrCreateAssociatedTokenAccount(
      connection,
      minter,
      mint.address,
      recipient,
      false,
      "confirmed"
    );

  /*
   * Convert using decimal-safe string handling.
   * This avoids floating-point problems.
   */

  const decimals =
    mint.decimals;

  const amountString =
    amount.toFixed(decimals);

  const parts =
    amountString.split(".");

  const whole =
    parts[0] || "0";

  const fraction =
    (parts[1] || "")
      .padEnd(
        decimals,
        "0"
      )
      .slice(
        0,
        decimals
      );

  const rawString =
    whole +
    fraction;

  const rawAmount =
    BigInt(rawString);

  if (
    rawAmount <= 0n
  ) {
    throw new Error(
      "Reward is too small."
    );
  }

  const signature =
    await mintTo(
      connection,
      minter,
      mint.address,
      tokenAccount.address,
      minter,
      rawAmount
    );

  return {
    signature,
    mint:
      mint.address.toBase58(),
    tokenAccount:
      tokenAccount.address.toBase58(),
    amount,
    decimals,
  };
}

// ============================================================
// CLAIM
// ============================================================

async function claimEarning(
  res,
  wallet
) {
  const database =
    getDatabase();

  const ref =
    sessionRef(wallet);

  const reservation =
    await database.runTransaction(
      async transaction => {
        const snap =
          await transaction.get(
            ref
          );

        if (!snap.exists) {
          throw new Error(
            "No earning session found."
          );
        }

        const session =
          snap.data();

        if (
          session.claimed
        ) {
          throw new Error(
            "This session has already been claimed."
          );
        }

        if (
          session.status ===
          "claiming"
        ) {
          throw new Error(
            "This reward is already being processed."
          );
        }

        const now =
          Date.now();

        const end =
          Number(
            session.sessionEnd ||
            0
          );

        if (
          session.status ===
            "active" &&
          end > now
        ) {
          const remaining =
            end - now;

          const hours =
            Math.ceil(
              remaining /
              3600000
            );

          throw new Error(
            `Session is
