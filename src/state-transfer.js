import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const GZIP_MIN_BYTES = 2048;

export function accountsRevision(accounts) {
  return createHash("sha1").update(JSON.stringify(accounts)).digest("base64url").slice(0, 22);
}

// The dashboard state carries every account (~800 KB for 1,500 accounts) and is
// polled every few seconds, often over a slow public link. This middleware keeps
// those responses small: the account list is left out when the client already
// holds the same revision (sent back in the X-Accounts-Rev header), and large
// JSON bodies are gzip-compressed.
export function compactJsonResponses() {
  return (request, response, next) => {
    const sendJson = response.json.bind(response);
    response.json = (body) => {
      if (body && typeof body === "object" && Array.isArray(body.accounts)) {
        const rev = accountsRevision(body.accounts);
        body = request.get("x-accounts-rev") === rev
          ? { ...body, accounts: undefined, accountsUnchanged: true, accountsRev: rev }
          : { ...body, accountsRev: rev };
      }
      if (!/\bgzip\b/i.test(request.get("accept-encoding") || "")) return sendJson(body);
      const payload = Buffer.from(JSON.stringify(body));
      if (payload.length < GZIP_MIN_BYTES) return sendJson(body);
      response.set("Content-Type", "application/json; charset=utf-8");
      response.set("Content-Encoding", "gzip");
      response.vary("Accept-Encoding");
      return response.send(gzipSync(payload));
    };
    next();
  };
}
