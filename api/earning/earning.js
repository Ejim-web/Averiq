const SESSION_MS = 24 * 60 * 60 * 1000;
const REWARD_AMOUNT = 10;

function sendJson(res, status, data) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(data));
}

function validWallet(wallet) {
  return (
    typeof wallet === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)
  );
}

/*
IMPORTANT:

This example stores session state in memory.

That is useful for testing the API response and fixing
the invalid-JSON problem, but it is NOT production-grade
because Vercel functions can restart.

For production, move sessions/claims into a real database
such as Firestore, Postgres, or another persistent store.
*/

const sessions = globalThis.__AVERIQ_SESSIONS__ ||
  (globalThis.__AVERIQ_SESSIONS__ = new Map());

function getSession(wallet) {
  return sessions.get(wallet) || null;
}

function setSession(wallet, value) {
  sessions.set(wallet, value);
}

export default async function handler(req, res) {

  try {

    if (req.method === "GET") {

      const action =
        req.query?.action;

      const wallet =
        req.query?.wallet;

      if (!validWallet(wallet)) {

        return sendJson(res, 400, {
          success: false,
          error: "Valid wallet address is required."
        });

      }

      if (action !== "status") {

        return sendJson(res, 400, {
          success: false,
          error: "Unsupported GET action."
        });

      }

      const session =
        getSession(wallet);

      if (!session) {

        return sendJson(res, 200, {
          success: true,
          sessionEnd: 0,
          sessionStarted: 0,
          sessionCompleted: false,
          claimable: 0
        });

      }

      const now =
        Date.now();

      const completed =
        now >= session.sessionEnd;

      return sendJson(res, 200, {
        success: true,
        sessionEnd:
          completed
            ? session.sessionEnd
            : session.sessionEnd,
        sessionStarted:
          session.sessionStarted,
        sessionCompleted:
          completed,
        claimable:
          completed && !session.claimed
            ? REWARD_AMOUNT
            : 0
      });

    }


    if (req.method !== "POST") {

      return sendJson(res, 405, {
        success: false,
        error: "Method not allowed."
      });

    }


    let body =
      req.body;


    if (typeof body === "string") {

      try {
        body = JSON.parse(body);
      } catch {

        return sendJson(res, 400, {
          success: false,
          error: "Request body is not valid JSON."
        });

      }

    }


    if (!body || typeof body !== "object") {

      return sendJson(res, 400, {
        success: false,
        error: "JSON request body is required."
      });

    }


    const {
      action,
      wallet
    } = body;


    if (!validWallet(wallet)) {

      return sendJson(res, 400, {
        success: false,
        error: "Valid wallet address is required."
      });

    }


    if (action === "start") {

      const existing =
        getSession(wallet);

      if (
        existing &&
        existing.sessionEnd > Date.now()
      ) {

        return sendJson(res, 409, {
          success: false,
          error: "An earning session is already running.",
          sessionStarted:
            existing.sessionStarted,
          sessionEnd:
            existing.sessionEnd
        });

      }


      if (
        existing &&
        existing.sessionEnd <= Date.now() &&
        !existing.claimed
      ) {

        return sendJson(res, 409, {
          success: false,
          error:
            "Your previous earning session is complete. Claim the reward before starting another session."
        });

      }


      const now =
        Date.now();

      const session = {
        wallet,
        sessionStarted: now,
        sessionEnd:
          now + SESSION_MS,
        claimed: false
      };


      setSession(
        wallet,
        session
      );


      return sendJson(res, 200, {
        success: true,
        sessionStarted:
          session.sessionStarted,
        sessionEnd:
          session.sessionEnd
      });

    }


    if (action === "claim") {

      const session =
        getSession(wallet);


      if (!session) {

        return sendJson(res, 400, {
          success: false,
          error:
            "No earning session exists for this wallet."
        });

      }


      if (session.claimed) {

        return sendJson(res, 409, {
          success: false,
          error:
            "This earning session has already been claimed."
        });

      }


      if (Date.now() < session.sessionEnd) {

        return sendJson(res, 400, {
          success: false,
          error:
            "The 24-hour earning session has not completed yet."
        });

      }


      /*
       * IMPORTANT:
       *
       * This is where the REAL Solana minting code belongs.
       *
       * Do NOT put the mint authority private key in index.html.
       *
       * Before this endpoint returns a real signature, configure
       * the Solana mint authority on the server and use it to mint
       * REWARD_AMOUNT AVQ to the user's associated token account.
       *
       * This safe version deliberately refuses to pretend that a
       * blockchain transaction happened.
       */

      return sendJson(res, 501, {
        success: false,
        error:
          "Session verified, but server-side AVQ minting is not configured yet. Add the secure Solana mint authority to the server before enabling real token minting."
      });

    }


    if (action === "checkin") {

      const today =
        new Date()
          .toISOString()
          .slice(0,10);

      const previous =
        getSession(
          wallet + ":checkin"
        );


      if (
        previous &&
        previous.date === today
      ) {

        return sendJson(res, 409, {
          success: false,
          error:
            "You already checked in today.",
          streak:
            previous.streak
        });

      }


      const streak =
        previous
          ? previous.streak + 1
          : 1;


      setSession(
        wallet + ":checkin",
        {
          date: today,
          streak
        }
      );


      return sendJson(res, 200, {
        success: true,
        streak
      });

    }


    return sendJson(res, 400, {
      success: false,
      error:
        "Unknown earning action."
    });


  } catch (error) {

    console.error(
      "AVERIQ API ERROR:",
      error
    );

    return sendJson(res, 500, {
      success: false,
      error:
        "Internal Averiq server error."
    });

  }

}
