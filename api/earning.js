// api/earning.js
// ============================================================
// AVERIQ - SECURE SOLANA AVQ EARNING API
// Vercel Serverless Function
// ============================================================
//
// REQUIRED ENVIRONMENT VARIABLES:
//
// SOLANA_RPC_URL=https://api.devnet.solana.com
//
// AVQ_MINT_ADDRESS=Ff6oxq9jqbhyJTBre56KtXLCuUFKixa6v5EN2qCAXX36
//
// REWARD_AMOUNT=10
//
// FIREBASE_PROJECT_ID=your-project-id
// FIREBASE_CLIENT_EMAIL=your-service-account-email
// FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
//
// AVQ_MINTER_SECRET_KEY=[JSON ARRAY OF SECRET KEY BYTES]
//
// IMPORTANT:
// The AVQ mint authority private key MUST stay in Vercel Environment
// Variables. NEVER put it in index.html.
//
// ============================================================

const {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
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

const SESSION_LENGTH_MS =
  24 * 60 * 60 * 1000;

const CHECKIN_REWARD =
  Number(process.env.CHECKIN_REWARD || "0.25");

const MAX_REWARD_AMOUNT =
  1000000;

// ============================================================
// FIREBASE INITIALIZATION
// ============================================================

let db = null;

function initializeFirebase() {
  if (db) {
    return db;
  }

  if (
    !process.env.FIREBASE_PROJECT_ID ||
    !process.env.FIREBASE_CLIENT_EMAIL ||
    !process.env.FIREBASE_PRIVATE_KEY
  ) {
    throw new Error(
      "Firebase environment variables are not configured."
    );
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
// SOLANA CONNECTION
// ============================================================

const connection = new Connection(
  RPC_URL,
  "confirmed"
);

// ============================================================
// JSON RESPONSE
// ============================================================

function json(res, statusCode, data) {
  res.statusCode = statusCode;

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  res.end(
    JSON.stringify(data)
  );
}

// ============================================================
// ERROR RESPONSE
// ============================================================

function errorResponse(
  res,
  statusCode,
  message,
  extra = {}
) {
  return json(
    res,
    statusCode,
    {
      success: false,
      error: message,
      ...extra,
    }
  );
}

// ============================================================
// READ JSON BODY SAFELY
// ============================================================

async function readBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body !== "string") {
    return {};
  }

  if (!req.body.trim()) {
    return {};
  }

  try {
    return JSON.parse(req.body);
  } catch {
    throw new Error(
      "Request body contains invalid JSON."
    );
  }
}

// ============================================================
// VALIDATE WALLET
// ============================================================

function validateWallet(wallet) {
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
// MINT AUTHORITY
// ============================================================

function getMinterKeypair() {
  const secret =
    process.env.AVQ_MINTER_SECRET_KEY;

  if (!secret) {
    throw new Error(
      "AVQ_MINTER_SECRET_KEY is not configured."
    );
  }

  let secretArray;

  try {
    secretArray =
      JSON.parse(secret);
  } catch {
    throw new Error(
      "AVQ_MINTER_SECRET_KEY must be a JSON array."
    );
  }

  if (
    !Array.isArray(secretArray) ||
    secretArray.length === 0
  ) {
    throw new Error(
      "Invalid AVQ mint authority secret key."
    );
  }

  return Keypair.fromSecretKey(
    Uint8Array.from(secretArray)
  );
}

// ============================================================
// LOAD MINT
// ============================================================

async function loadMint() {
  const mintPublicKey =
    new PublicKey(
      AVQ_MINT_ADDRESS
    );

  return getMint(
    connection,
    mintPublicKey
  );
}

// ============================================================
// SESSION DOCUMENT
// ============================================================

function sessionRef(wallet) {
  const database =
    initializeFirebase();

  return database
    .collection("averiq_earning_sessions")
    .doc(wallet);
}

// ============================================================
// CHECK-IN DOCUMENT
// ============================================================

function checkinRef(wallet) {
  const database =
    initializeFirebase();

  return database
    .collection("averiq_checkins")
    .doc(wallet);
}

// ============================================================
// CLAIM DOCUMENT
// ============================================================

function claimRef(wallet) {
  const database =
    initializeFirebase();

  return database
    .collection("averiq_claims")
    .doc(wallet);
}

// ============================================================
// GET SESSION
// ============================================================

async function getSession(wallet) {
  const ref =
    sessionRef(wallet);

  const snap =
    await ref.get();

  if (!snap.exists) {
    return null;
  }

  return snap.data();
}

// ============================================================
// START SESSION
// ============================================================

async function startSession(
  res,
  wallet
) {
  const now =
    Date.now();

  const existing =
    await getSession(wallet);

  if (existing) {
    const end =
      Number(
        existing.sessionEnd || 0
      );

    if (
      existing.status === "active" &&
      end > now
    ) {
      return json(
        res,
        200,
        {
          success: true,
          alreadyRunning: true,
          sessionEnd: end,
          sessionCompleted: false,
          message:
            "Earning session is already running.",
        }
      );
    }

    if (
      existing.status === "completed" &&
      !existing.claimed
    ) {
      return json(
        res,
        409,
        {
          success: false,
          error:
            "Your previous earning session is complete. Claim the reward before starting another session.",
          sessionEnd: null,
          sessionCompleted: true,
        }
      );
    }
  }

  const sessionEnd =
    now +
    SESSION_LENGTH_MS;

  const ref =
    sessionRef(wallet);

  await ref.set(
    {
      wallet,

      status:
        "active",

      startedAt:
        now,

      sessionEnd,

      claimed:
        false,

      rewardAmount:
        REWARD_AMOUNT,

      updatedAt:
        now,
    },
    {
      merge: true,
    }
  );

  return json(
    res,
    200,
    {
      success: true,

      action:
        "start",

      wallet,

      sessionEnd,

      sessionCompleted:
        false,

      rewardAmount:
        REWARD_AMOUNT,

      message:
        "24-hour earning session started.",
    }
  );
}

// ============================================================
// SESSION STATUS
// ============================================================

async function sessionStatus(
  res,
  wallet
) {
  const session =
    await getSession(wallet);

  if (!session) {
    return json(
      res,
      200,
      {
        success: true,

        sessionEnd:
          null,

        sessionCompleted:
          false,

        claimed:
          false,

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
    "completed";

  if (
    session.status === "active" &&
    end > 0 &&
    end <= now
  ) {
    await sessionRef(wallet)
      .set(
        {
          status:
            "completed",

          completedAt:
            now,

          updatedAt:
            now,
        },
        {
          merge: true,
        }
      );

    completed =
      true;
  }

  return json(
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
// MINT AVQ
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
      "Reward amount exceeds the server limit."
    );
  }

  const recipient =
    validateWallet(wallet);

  const minter =
    getMinterKeypair();

  const mint =
    await loadMint();

  // Make sure the configured mint is actually
  // controlled by the server's minter.
  if (
    !mint.mintAuthority
  ) {
    throw new Error(
      "AVQ mint has no mint authority. New tokens cannot be minted."
    );
  }

  if (
    !mint.mintAuthority.equals(
      minter.publicKey
    )
  ) {
    throw new Error(
      "Server mint authority does not match the AVQ mint authority."
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

  const multiplier =
    10 ** mint.decimals;

  const rawAmount =
    BigInt(
      Math.round(
        amount *
        multiplier
      )
    );

  if (
    rawAmount <= 0n
  ) {
    throw new Error(
      "Reward is too small for the AVQ token decimals."
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

    tokenAccount:
      tokenAccount.address.toBase58(),

    amount,

    decimals:
      mint.decimals,

    mint:
      mint.address.toBase58(),

    authority:
      minter.publicKey.toBase58(),
  };
}

// ============================================================
// CLAIM REWARD
// ============================================================

async function claimReward(
  res,
  wallet
) {
  const ref =
    sessionRef(wallet);

  const database =
    initializeFirebase();

  // Firestore transaction prevents two simultaneous
  // requests from both claiming the same session.
  const result =
    await database.runTransaction(
      async (transaction) => {
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
            "This earning session has already been claimed."
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
            `Your earning session is not complete yet. Approximately ${hours} hour(s) remaining.`
          );
        }

        const reward =
          Number(
            session.rewardAmount ||
            REWARD_AMOUNT
          );

        if (
          reward <= 0
        ) {
          throw new Error(
            "Invalid session reward."
          );
        }

        transaction.update(
          ref,
          {
            status:
              "claiming",

            updatedAt:
              now,
          }
        );

        return {
          reward,
          sessionStartedAt:
            session.startedAt,
          sessionEnd:
            end,
        };
      }
    );

  let mintResult;

  try {
    mintResult =
      await mintAVQ(
        wallet,
        result.reward
      );
  } catch (error) {
    // Put the session back into completed state
    // if the blockchain transaction failed.
    await ref.set(
      {
        status:
          "completed",

        claimed:
          false,

        updatedAt:
          Date.now(),

        lastError:
          error.message,
      },
      {
        merge: true,
      }
    );

    throw error;
  }

  const now =
    Date.now();

  // Permanently mark this session as claimed
  // only after the blockchain transaction succeeds.
  await ref.set(
    {
      status:
        "claimed",

      claimed:
        true,

      claimedAt:
        now,

      signature:
        mintResult.signature,

      tokenAccount:
        mintResult.tokenAccount,

      updatedAt:
        now,
    },
    {
      merge: true,
    }
  );

  // Store transaction history.
  await database
    .collection(
      "averiq_reward_transactions"
    )
    .add({
      wallet,

      amount:
        mintResult.amount,

      mint:
        mintResult.mint,

      tokenAccount:
        mintResult.tokenAccount,

      signature:
        mintResult.signature,

      type:
        "earning",

      network:
        "devnet",

      createdAt:
        now,
    });

  return json(
    res,
    200,
    {
      success:
        true,

      action:
        "claim",

      signature:
        mintResult.signature,

      amount:
        mintResult.amount,

      mint:
        mintResult.mint,

      tokenAccount:
        mintResult.tokenAccount,

      message:
        "AVQ reward minted successfully on Solana.",
    }
  );
}

// ============================================================
// CHECK-IN
// ============================================================

async function checkIn(
  res,
  wallet
) {
  const ref =
    checkinRef(wallet);

  const database =
    initializeFirebase();

  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  const result =
    await database.runTransaction(
      async (transaction) => {
        const snap =
          await transaction.get(
            ref
          );

        let data =
          snap.exists
            ? snap.data()
            : {};

        if (
          data.lastCheckIn ===
          today
        ) {
          throw new Error(
            "You already checked in today."
          );
        }

        const previousDate =
          data.lastCheckIn ||
          null;

        let streak =
          Number(
            data.streak || 0
          );

        if (
          previousDate
        ) {
          const previous =
            new Date(
              previousDate +
              "T00:00:00Z"
            );

          const current =
            new Date(
              today +
              "T00:00:00Z"
            );

          const difference =
            Math.round(
              (
                current -
                previous
              ) /
              86400000
            );

          if (
            difference === 1
          ) {
            streak += 1;
          } else {
            streak = 1;
          }
        } else {
          streak = 1;
        }

        transaction.set(
          ref,
          {
            wallet,

            lastCheckIn:
              today,

            streak,

            updatedAt:
              Date.now(),
          },
          {
            merge: true,
          }
        );

        return {
          streak,
        };
      }
    );

  return json(
    res,
    200,
    {
      success:
        true,

      action:
        "checkin",

      streak:
        result.streak,

      reward:
        CHECKIN_REWARD,

      message:
        "Daily check-in recorded successfully.",
    }
  );
}

// ============================================================
// HEALTH CHECK
// ============================================================

async function healthCheck(
  res
) {
  try {
    const mint =
      await loadMint();

    return json(
      res,
      200,
      {
        success:
          true,

        api:
          "Averiq Earning API",

        status:
          "online",

        network:
          RPC_URL.includes(
            "devnet"
          )
            ? "Solana Devnet"
            : "Solana",

        mint:
          mint.address.toBase58(),

        decimals:
          mint.decimals,

        mintAuthority:
          mint.mintAuthority
            ? mint.mintAuthority.toBase58()
            : null,
      }
    );
  } catch (error) {
    return errorResponse(
      res,
      500,
      error.message
    );
  }
}

// ============================================================
// MAIN VERCEL HANDLER
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {
    // --------------------------------------------------------
    // CORS
    // --------------------------------------------------------

    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,OPTIONS"
    );

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );

    // --------------------------------------------------------
    // OPTIONS
    // --------------------------------------------------------

    if (
      req.method ===
      "OPTIONS"
    ) {
      return json(
        res,
        200,
        {
          success:
            true,
        }
      );
    }

    try {
      // ------------------------------------------------------
      // GET
      // ------------------------------------------------------

      if (
        req.method ===
        "GET"
      ) {
        const action =
          String(
            req.query?.action ||
            "health"
          ).toLowerCase();

        if (
          action ===
          "health"
        ) {
          return healthCheck(
            res
          );
        }

        if (
          action ===
          "status"
        ) {
          const wallet =
            req.query?.wallet;

          validateWallet(
            wallet
          );

          return sessionStatus(
            res,
            wallet
          );
        }

        return errorResponse(
          res,
          400,
          "Unknown GET action."
        );
      }

      // ------------------------------------------------------
      // POST
      // ------------------------------------------------------

      if (
        req.method ===
        "POST"
      ) {
        const body =
          await readBody(req);

        const action =
          String(
            body.action || ""
          ).toLowerCase();

        if (
          !action
        ) {
          return errorResponse(
            res,
            400,
            "Missing action."
          );
        }

        const wallet =
          body.wallet;

        validateWallet(
          wallet
        );

        switch (
          action
        ) {
          case "start":
            return await startSession(
              res,
              wallet
            );

          case "claim":
            return await claimReward(
              res,
              wallet
            );

          case "checkin":
            return await checkIn(
              res,
              wallet
            );

          default:
            return errorResponse(
              res,
              400,
              "Unknown action. Supported actions: start, claim, checkin."
            );
        }
      }

      // ------------------------------------------------------
      // METHOD NOT ALLOWED
      // ------------------------------------------------------

      return errorResponse(
        res,
        405,
        "Method not allowed. Use GET or POST."
      );

    } catch (error) {
      console.error(
        "AVERIQ EARNING API ERROR:",
        error
      );

      return errorResponse(
        res,
        500,
        error.message ||
          "Internal server error."
      );
    }
  };
