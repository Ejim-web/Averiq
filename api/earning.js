// ============================================================
// AVERIQ - EARNING API
// Solana Devnet + Firebase + Vercel
// ============================================================
//
// ENDPOINT:
//
// GET  /api/earning
// GET  /api/earning?action=health
// GET  /api/earning?action=status&wallet=YOUR_WALLET
//
// POST /api/earning
//
// Body:
// {
//   "action": "start",
//   "wallet": "YOUR_WALLET"
// }
//
// Supported POST actions:
//
// start
// claim
// checkin
//
// ============================================================

const {
  Connection,
  PublicKey,
  Keypair
} = require("@solana/web3.js");

const {
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo
} = require("@solana/spl-token");

const admin = require("firebase-admin");

// ============================================================
// CONFIGURATION
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

  const projectId =
    process.env.FIREBASE_PROJECT_ID;

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL;

  const privateKey =
    process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId) {
    throw new Error(
      "Missing FIREBASE_PROJECT_ID."
    );
  }

  if (!clientEmail) {
    throw new Error(
      "Missing FIREBASE_CLIENT_EMAIL."
    );
  }

  if (!privateKey) {
    throw new Error(
      "Missing FIREBASE_PRIVATE_KEY."
    );
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential:
        admin.credential.cert({
          projectId,
          clientEmail,
          privateKey:
            privateKey.replace(
              /\\n/g,
              "\n"
            )
        })
    });
  }

  db =
    admin.firestore();

  return db;
}

// ============================================================
// SOLANA CONNECTION
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
  statusCode,
  data
) {
  if (res.headersSent) {
    return;
  }

  res.statusCode =
    statusCode;

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

// ============================================================
// ERROR RESPONSE
// ============================================================

function sendError(
  res,
  statusCode,
  message,
  extra = {}
) {
  return sendJSON(
    res,
    statusCode,
    {
      success: false,
      error: message,
      ...extra
    }
  );
}

// ============================================================
// READ REQUEST BODY
// ============================================================

async function readBody(req) {
  // Vercel may already parse req.body.
  if (
    req.body !== undefined &&
    req.body !== null
  ) {
    if (
      typeof req.body === "object"
    ) {
      return req.body;
    }

    if (
      typeof req.body === "string"
    ) {
      if (
        !req.body.trim()
      ) {
        return {};
      }

      try {
        return JSON.parse(
          req.body
        );
      } catch {
        throw new Error(
          "Request body contains invalid JSON."
        );
      }
    }
  }

  // Fallback body parser.
  return new Promise(
    (resolve, reject) => {
      let raw = "";

      req.on(
        "data",
        chunk => {
          raw +=
            chunk.toString();

          if (
            raw.length >
            1024 * 1024
          ) {
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
          if (
            !raw.trim()
          ) {
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
                "Request body contains invalid JSON."
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

function validateWallet(
  wallet
) {
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
// MINTER KEYPAIR
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
      "AVQ_MINTER_SECRET_KEY must be a valid JSON array."
    );
  }

  if (
    !Array.isArray(
      secretArray
    )
  ) {
    throw new Error(
      "AVQ_MINTER_SECRET_KEY must be an array."
    );
  }

  if (
    secretArray.length !== 64
  ) {
    throw new Error(
      "AVQ_MINTER_SECRET_KEY must contain 64 bytes."
    );
  }

  try {
    return Keypair.fromSecretKey(
      Uint8Array.from(
        secretArray
      )
    );
  } catch {
    throw new Error(
      "AVQ mint authority private key is invalid."
    );
  }
}

// ============================================================
// MINT
// ============================================================

async function loadMint() {
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

function sessionRef(
  wallet
) {
  return getDatabase()
    .collection(
      "averiq_earning_sessions"
    )
    .doc(wallet);
}

function checkinRef(
  wallet
) {
  return getDatabase()
    .collection(
      "averiq_checkins"
    )
    .doc(wallet);
}

// ============================================================
// READ SESSION
// ============================================================

async function getSession(
  wallet
) {
  const snapshot =
    await sessionRef(
      wallet
    ).get();

  if (
    !snapshot.exists
  ) {
    return null;
  }

  return snapshot.data();
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

    let mintAuthority =
      null;

    if (
      mint.mintAuthority
    ) {
      mintAuthority =
        mint.mintAuthority.toBase58();
    }

    return sendJSON(
      res,
      200,
      {
        success: true,
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
        mintAuthority
      }
    );
  } catch (error) {
    console.error(
      "HEALTH ERROR:",
      error
    );

    return sendError(
      res,
      500,
      error.message
    );
  }
}

// ============================================================
// START EARNING
// ============================================================

async function startEarning(
  res,
  wallet
) {
  const now =
    Date.now();

  const existing =
    await getSession(
      wallet
    );

  if (existing) {
    const end =
      Number(
        existing.sessionEnd ||
        0
      );

    if (
      existing.status ===
        "active" &&
      end > now
    ) {
      return sendJSON(
        res,
        200,
        {
          success: true,
          action:
            "start",
          alreadyRunning:
            true,
          sessionEnd:
            end,
          sessionCompleted:
            false,
          rewardAmount:
            Number(
              existing.rewardAmount ||
              REWARD_AMOUNT
            ),
          message:
            "Your earning session is already running."
        }
      );
    }

    if (
      (
        existing.status ===
          "completed" ||
        existing.status ===
          "claiming"
      ) &&
      !existing.claimed
    ) {
      return sendJSON(
        res,
        409,
        {
          success: false,
          error:
            "Your previous earning session is complete. Claim your reward first.",
          sessionCompleted:
            true,
          sessionEnd:
            null
        }
      );
    }
  }

  const sessionEnd =
    now +
    SESSION_LENGTH_MS;

  await sessionRef(
    wallet
  ).set(
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
        now
    },
    {
      merge: true
    }
  );

  return sendJSON(
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
      claimed:
        false,
      rewardAmount:
        REWARD_AMOUNT,
      message:
        "24-hour earning session started."
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
    await getSession(
      wallet
    );

  if (!session) {
    return sendJSON(
      res,
      200,
      {
        success: true,
        wallet,
        sessionEnd:
          null,
        sessionCompleted:
          false,
        claimed:
          false,
        rewardAmount:
          REWARD_AMOUNT
      }
    );
  }

  const now =
    Date.now();

  const end =
    Number(
      session.sessionEnd ||
      0
    );

  let completed =
    session.status ===
      "completed" ||
    session.status ===
      "claiming" ||
    session.status ===
      "claimed";

  if (
    session.status ===
      "active" &&
    end > 0 &&
    end <= now
  ) {
    await sessionRef(
      wallet
    ).set(
      {
        status:
          "completed",
        completedAt:
          now,
        updatedAt:
          now
      },
      {
        merge: true
      }
    );

    completed =
      true;
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
        )
    }
  );
}

// ============================================================
// MINT AVQ ON SOLANA
// ============================================================

async function mintAVQ(
  wallet,
  amount
) {
  if (
    !Number.isFinite(
      amount
    ) ||
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
    validateWallet(
      wallet
    );

  const minter =
    getMinterKeypair();

  const mint =
    await loadMint();

  if (
    !mint.mintAuthority
  ) {
    throw new Error(
      "The AVQ mint has no mint authority."
    );
  }

  if (
    !mint.mintAuthority.equals(
      minter.publicKey
    )
  ) {
    throw new Error(
      "The configured server wallet is not the AVQ mint authority."
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

  const decimals =
    mint.decimals;

  /*
   * Convert AVQ to the token's smallest unit.
   */

  const amountText =
    amount.toFixed(
      decimals
    );

  const parts =
    amountText.split(
      "."
    );

  const whole =
    parts[0] || "0";

  const fraction =
    (
      parts[1] || ""
    )
      .padEnd(
        decimals,
        "0"
      )
      .slice(
        0,
        decimals
      );

  const rawAmount =
    BigInt(
      whole + fraction
    );

  if (
    rawAmount <= 0n
  ) {
    throw new Error(
      "Reward is too small to mint."
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
    authority:
      minter.publicKey.toBase58()
  };
}

// ============================================================
// CLAIM EARNING
// ============================================================

async function claimEarning(
  res,
  wallet
) {
  const database =
    getDatabase();

  const ref =
    sessionRef(
      wallet
    );

  const reservation =
    await database.runTransaction(
      async transaction => {
        const snapshot =
          await transaction.get(
            ref
          );

        if (
          !snapshot.exists
        ) {
          throw new Error(
            "No earning session found."
          );
        }

        const session =
          snapshot.data();

        if (
          session.claimed
        ) {
          throw new Error(
            "This earning session has already been claimed."
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
            `Your earning session is not complete yet. Approximately ${hours} hour(s) remaining.`
          );
        }

        const reward =
          Number(
            session.rewardAmount ||
            REWARD_AMOUNT
          );

        if (
          !Number.isFinite(
            reward
          ) ||
          reward <= 0
        ) {
          throw new Error(
            "Invalid reward amount."
          );
        }

        transaction.update(
          ref,
          {
            status:
              "claiming",
            claimStartedAt:
              now,
            updatedAt:
              now
          }
        );

        return {
          reward
        };
      }
    );

  let mintResult;

  try {
    mintResult =
      await mintAVQ(
        wallet,
        reservation.reward
      );
  } catch (error) {
    console.error(
      "MINT ERROR:",
      error
    );

    await ref.set(
      {
        status:
          "completed",
        claimed:
          false,
        lastError:
          error.message,
        updatedAt:
          Date.now()
      },
      {
        merge: true
      }
    );

    throw error;
  }

  const now =
    Date.now();

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
      mint:
        mintResult.mint,
      updatedAt:
        now
    },
    {
      merge: true
    }
  );

  await database
    .collection(
      "averiq_reward_transactions"
    )
    .add(
      {
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
          RPC_URL.includes(
            "devnet"
          )
            ? "devnet"
            : "mainnet",
        createdAt:
          now
      }
    );

  return sendJSON(
    res,
    200,
    {
      success: true,
      action:
        "claim",
      amount:
        mintResult.amount,
      mint:
        mintResult.mint,
      tokenAccount:
        mintResult.tokenAccount,
      signature:
        mintResult.signature,
      explorer:
        `https://explorer.solana.com/tx/${mintResult.signature}?cluster=devnet`,
      message:
        "AVQ reward minted successfully on Solana."
    }
  );
}

// ============================================================
// DAILY CHECK-IN
// ============================================================

async function checkIn(
  res,
  wallet
) {
  const database =
    getDatabase();

  const ref =
    checkinRef(
      wallet
    );

  const today =
    new Date()
      .toISOString()
      .slice(
        0,
        10
      );

  const result =
    await database.runTransaction(
      async transaction => {
        const snapshot =
          await transaction.get(
            ref
          );

        const data =
          snapshot.exists
            ? snapshot.data()
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
            data.streak ||
            0
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
              Date.now()
          },
          {
            merge: true
          }
        );

        return {
          streak
        };
      }
    );

  return sendJSON(
    res,
    200,
    {
      success: true,
      action:
        "checkin",
      wallet,
      streak:
        result.streak,
      reward:
        CHECKIN_REWARD,
      message:
        "Daily check-in recorded successfully."
    }
  );
}

// ============================================================
// MAIN VERCEL FUNCTION
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
      "GET, POST, OPTIONS"
    );

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );

    res.setHeader(
      "Access-Control-Max-Age",
      "86400"
    );

    // --------------------------------------------------------
    // OPTIONS
    // --------------------------------------------------------

    if (
      req.method ===
      "OPTIONS"
    ) {
      return sendJSON(
        res,
        200,
        {
          success: true
        }
      );
    }

    // --------------------------------------------------------
    // GET
    // --------------------------------------------------------

    if (
      req.method ===
      "GET"
    ) {
      try {
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

        return sendError(
          res,
          400,
          "Unknown GET action. Use health or status."
        );
      } catch (error) {
        console.error(
          "GET ERROR:",
          error
        );

        return sendError(
          res,
          500,
          error.message ||
            "Internal server error."
        );
      }
    }

    // --------------------------------------------------------
    // POST
    // --------------------------------------------------------

    if (
      req.method ===
      "POST"
    ) {
      try {
        const body =
          await readBody(
            req
          );

        const action =
          String(
            body.action ||
            ""
          ).toLowerCase();

        if (!action) {
          return sendError(
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
            return await startEarning(
              res,
              wallet
            );

          case "claim":
            return await claimEarning(
              res,
              wallet
            );

          case "checkin":
            return await checkIn(
              res,
              wallet
            );

          default:
            return sendError(
              res,
              400,
              "Unknown action. Supported actions: start, claim, checkin."
            );
        }
      } catch (error) {
        console.error(
          "POST ERROR:",
          error
        );

        const message =
          error.message ||
          "Internal server error.";

        const status =
          message.includes(
            "already"
          ) ||
          message.includes(
            "not complete"
          ) ||
          message.includes(
            "ready to claim"
          )
            ? 409
            : 500;

        return sendError(
          res,
          status,
          message
        );
      }
    }

    // --------------------------------------------------------
    // METHOD NOT ALLOWED
    // --------------------------------------------------------

    return sendError(
      res,
      405,
      "Method not allowed. Use GET, POST, or OPTIONS."
    );
  };
