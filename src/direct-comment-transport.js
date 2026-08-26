// This function is serialized by Playwright and runs inside gosh6.app. Keep it
// self-contained: references to module-level helpers are not available there.
export async function sendCommentViaWebsiteTransport(input) {
  const pageGlobal = globalThis;
  const bridgeCacheKey = "__goshCommentAssistantDirectTransportV1";
  const cleanContent = String(input?.content ?? "").trim();
  const timeoutMs = Math.max(1_000, Number(input?.timeoutMs) || 12_000);

  if (!cleanContent) {
    return { status: "failed", attempted: false, reason: "comment_empty" };
  }

  function unavailable(reason) {
    return { status: "unavailable", attempted: false, reason };
  }

  function functionSource(value) {
    try {
      return Function.prototype.toString.call(value);
    } catch {
      return "";
    }
  }

  function captureWebpackRequire() {
    const queueName = Object.keys(pageGlobal).find((key) => /^webpackChunk/.test(key));
    const chunkQueue = queueName ? pageGlobal[queueName] : null;
    if (!Array.isArray(chunkQueue)) return null;

    let runtimeRequire = null;
    const chunkId = `gosh-comment-assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    chunkQueue.push([[chunkId], {}, (candidate) => {
      runtimeRequire = candidate;
    }]);
    return runtimeRequire;
  }

  function requireModuleMatching(runtimeRequire, markers) {
    for (const [moduleId, factory] of Object.entries(runtimeRequire.m || {})) {
      const source = functionSource(factory);
      if (!markers.every((marker) => source.includes(marker))) continue;
      try {
        return runtimeRequire(moduleId);
      } catch {
        // A marker collision or optional module must not break discovery.
      }
    }
    return null;
  }

  function findStore(moduleExports, requiredStateKeys) {
    for (const value of Object.values(moduleExports || {})) {
      if (typeof value !== "function" || typeof value.getState !== "function") continue;
      try {
        const state = value.getState();
        if (requiredStateKeys.every((key) => key in (state || {}))) return value;
      } catch {
        // Ignore non-Zustand exports that happen to expose getState.
      }
    }
    return null;
  }

  function discoverBridge() {
    const runtimeRequire = captureWebpackRequire();
    if (!runtimeRequire?.m) return null;

    const sendModule = requireModuleMatching(runtimeRequire, [
      "chat_target_group_missing",
      "payloadData",
      "client_request_id",
    ]);
    const accountModule = requireModuleMatching(runtimeRequire, [
      "setAuthenticatedAccount",
      "refreshAccount",
      "sessionRevision",
    ]);
    const liveModule = requireModuleMatching(runtimeRequire, [
      "anchorSensitiveWords",
      "fetchJoinRoom",
      "currentLive",
    ]);
    const accountSanitizerModule = requireModuleMatching(runtimeRequire, [
      "tim_user_sig",
      "is_show_transfer",
      "last_login_at",
    ]);

    const send = Object.values(sendModule || {}).find((value) => {
      const source = functionSource(value);
      return typeof value === "function"
        && source.includes("chat_target_group_missing")
        && source.includes("payloadData");
    });
    const sanitizeAccount = Object.values(accountSanitizerModule || {}).find((value) => {
      const source = functionSource(value);
      return typeof value === "function"
        && source.includes("tim_user_sig")
        && source.includes("is_show_transfer");
    });
    const accountStore = findStore(accountModule, ["account", "loginType", "sessionRevision"]);
    const liveStore = findStore(liveModule, ["anchorInfo", "currentLive", "liveRoom"]);

    if (!send || !sanitizeAccount || !accountStore || !liveStore) return null;
    return { send, sanitizeAccount, accountStore, liveStore };
  }

  let bridge = pageGlobal[bridgeCacheKey];
  if (!bridge) {
    try {
      bridge = discoverBridge();
    } catch {
      return unavailable("website_transport_discovery_failed");
    }
    if (!bridge) return unavailable("website_transport_not_found");
    try {
      Object.defineProperty(pageGlobal, bridgeCacheKey, {
        configurable: true,
        enumerable: false,
        value: bridge,
      });
    } catch {
      // Caching is an optimization; sending still works without it.
    }
  }

  let payloadData;
  let groupId = "";
  try {
    const account = bridge.accountStore.getState()?.account;
    const liveState = bridge.liveStore.getState() || {};
    if (!account?.id) return unavailable("website_account_not_ready");

    const liveId = liveState.anchorInfo?.live_info?.live_id
      ?? liveState.currentLive?.id
      ?? liveState.liveRoom?.live?.id;
    if (!liveId) return unavailable("website_live_room_not_ready");

    groupId = String(
      liveState.currentLive?.im_room
      ?? liveState.liveRoom?.live?.im_room
      ?? liveState.anchorInfo?.live_info?.im_room
      ?? "",
    );

    const roomData = liveState.liveRoomData || {};
    const optionalRoomFields = {};
    for (const key of ["room_role_infos", "platform_role_infos", "room_describe_rank_info"]) {
      const value = roomData[key];
      if (Array.isArray(value) ? value.length > 0 : Boolean(value?.icon)) {
        optionalRoomFields[key] = value;
      }
    }

    payloadData = JSON.stringify({
      type: 10_000,
      msg_id: 0,
      user: bridge.sanitizeAccount(account),
      data: {
        text: cleanContent,
        rich_content: [{ type: "text", text: cleanContent }],
      },
      occur_at: Math.floor(Date.now() / 1_000),
      live_id: liveId,
      ...optionalRoomFields,
    });
  } catch {
    return unavailable("website_payload_not_ready");
  }

  let attempted = false;
  let timeoutId;
  try {
    attempted = true;
    const result = await Promise.race([
      bridge.send({ groupId, payloadData }),
      new Promise((_, reject) => {
        timeoutId = pageGlobal.setTimeout(
          () => reject(new Error("website_transport_timeout")),
          timeoutMs,
        );
      }),
    ]);
    pageGlobal.clearTimeout(timeoutId);
    return {
      status: "sent",
      attempted: true,
      provider: result?.provider || "tencent",
      providerMessageId: result?.providerMessageId || "",
      sentAt: result?.sentAt || Date.now(),
    };
  } catch (error) {
    pageGlobal.clearTimeout(timeoutId);
    return {
      status: "failed",
      attempted,
      reason: String(error?.message || error || "website_transport_failed").slice(0, 240),
    };
  }
}

// This function is serialized by Playwright and runs inside loco.com. It calls
// the same Chat V2 REST client used by Loco's own send button, so auth headers
// and any website-side routing stay aligned with the currently loaded site.
export async function sendCommentViaLocoTransport(input) {
  const pageGlobal = globalThis;
  const bridgeCacheKey = "__locoCommentAssistantDirectTransportV1";
  const cleanContent = String(input?.content ?? "").trim();
  const preferredStreamId = String(input?.streamId ?? "").trim();
  const timeoutMs = Math.max(1_000, Number(input?.timeoutMs) || 12_000);

  if (!cleanContent) {
    return { status: "failed", attempted: false, reason: "comment_empty" };
  }

  function unavailable(reason) {
    return { status: "unavailable", attempted: false, reason };
  }

  function functionSource(value) {
    try {
      return Function.prototype.toString.call(value);
    } catch {
      return "";
    }
  }

  function captureWebpackRequire() {
    const queueName = Object.keys(pageGlobal).find((key) => /^webpackChunk/.test(key));
    const chunkQueue = queueName ? pageGlobal[queueName] : null;
    if (!Array.isArray(chunkQueue)) return null;

    let runtimeRequire = null;
    const chunkId = `loco-comment-assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    chunkQueue.push([[chunkId], {}, (candidate) => {
      runtimeRequire = candidate;
    }]);
    return runtimeRequire;
  }

  function requireModuleMatching(runtimeRequire, markers) {
    for (const [moduleId, factory] of Object.entries(runtimeRequire.m || {})) {
      const source = functionSource(factory);
      if (!markers.every((marker) => source.includes(marker))) continue;
      try {
        return runtimeRequire(moduleId);
      } catch {
        // Optional modules and marker collisions are safe to ignore.
      }
    }
    return null;
  }

  function findStore(moduleExports, requiredStateKeys) {
    for (const value of Object.values(moduleExports || {})) {
      if (typeof value !== "function" || typeof value.getState !== "function") continue;
      try {
        const state = value.getState();
        if (requiredStateKeys.every((key) => key in (state || {}))) return value;
      } catch {
        // Ignore non-Zustand exports that happen to expose getState.
      }
    }
    return null;
  }

  function findStoreInMatchingModules(runtimeRequire, markers, requiredStateKeys, preferState) {
    let fallback = null;
    for (const [moduleId, factory] of Object.entries(runtimeRequire.m || {})) {
      const source = functionSource(factory);
      if (!markers.every((marker) => source.includes(marker))) continue;
      try {
        const store = findStore(runtimeRequire(moduleId), requiredStateKeys);
        if (!store) continue;
        fallback ||= store;
        if (preferState?.(store.getState() || {})) return store;
      } catch {
        // Keep scanning: Next.js can bundle both an empty template store and
        // the hydrated store used by the active stream page.
      }
    }
    return fallback;
  }

  function discoverBridge() {
    const runtimeRequire = captureWebpackRequire();
    if (!runtimeRequire?.m) return null;

    const chatApiModule = requireModuleMatching(runtimeRequire, [
      "/chat/?send=true",
      "X-CLIENT-ID",
      "X-CLIENT-SECRET",
    ]);
    const fingerprintModule = requireModuleMatching(runtimeRequire, [
      "endsWith(\"live\")",
      "fingerprint",
      "x64hash128",
    ]);
    const userModule = requireModuleMatching(runtimeRequire, [
      "setAccessToken",
      "refreshToken",
      "isSignUp",
    ]);
    const streamMarkers = [
      "followDelayRunningTimer",
      "setSlowModeTime",
      "isChatTimeStamps",
    ];
    const appModule = requireModuleMatching(runtimeRequire, [
      "sessionUid",
      "requestCountryCode",
      "setAppLanguage",
    ]);

    const sendCandidates = Object.values(chatApiModule || {}).filter((value) => {
      const source = functionSource(value);
      return typeof value === "function"
        && source.includes("/chat/?send=true")
        && source.includes("X-CLIENT-ID")
        && source.includes(".post(");
    }).sort((a, b) => {
      const srcA = functionSource(a);
      const srcB = functionSource(b);
      const scoreA = srcA.includes("params") ? 2 : (srcA.includes("body") ? 1 : 0);
      const scoreB = srcB.includes("params") ? 2 : (srcB.includes("body") ? 1 : 0);
      return scoreB - scoreA;
    });
    const send = sendCandidates[0];
    const getFingerprint = Object.values(fingerprintModule || {}).find((value) => {
      const source = functionSource(value);
      return typeof value === "function"
        && source.includes("fingerprint")
        && source.includes("endsWith(\"live\")");
    });
    const userStore = findStore(userModule, ["me", "accessToken", "setAccessToken"]);
    const streamStore = findStoreInMatchingModules(
      runtimeRequire,
      streamMarkers,
      ["stream", "isModerator", "slowModeTime"],
      (state) => Boolean(state.stream?.uid || state.streamID),
    );
    const appStore = findStore(appModule, ["sessionUid", "appLanguage", "requestCountryCode"]);

    if (!send || !getFingerprint || !userStore || !streamStore || !appStore) return null;
    return { send, sendCandidates, getFingerprint, userStore, streamStore, appStore };
  }

  let bridge = pageGlobal[bridgeCacheKey];
  if (!bridge) {
    try {
      bridge = discoverBridge();
    } catch {
      return unavailable("website_transport_discovery_failed");
    }
    if (!bridge) return unavailable("website_transport_not_found");
    try {
      Object.defineProperty(pageGlobal, bridgeCacheKey, {
        configurable: true,
        enumerable: false,
        value: bridge,
      });
    } catch {
      // Caching is optional; sending still works without it.
    }
  }

  let params;
  let streamId;
  try {
    const me = bridge.userStore.getState()?.me;
    const streamState = bridge.streamStore.getState() || {};
    const stream = streamState.stream;
    const sessionUid = bridge.appStore.getState()?.sessionUid;
    if (!me?.user_uid) return unavailable("website_account_not_ready");

    streamId = preferredStreamId || String(stream?.uid || "");
    if (!streamId) return unavailable("website_live_room_not_ready");
    if (!sessionUid) return unavailable("website_session_not_ready");

    const fingerprint = await bridge.getFingerprint();
    if (!fingerprint) return unavailable("website_device_not_ready");

    const msgId = typeof pageGlobal.crypto?.randomUUID === "function"
      ? pageGlobal.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    params = {
      message: cleanContent,
      msgId,
      deviceId: `${fingerprint}-${sessionUid}`,
      msg_time: Date.now(),
      moderator_type: streamState.isModerator || 0,
      profile: {
        avatar: me.avatar_url,
        color: "#777777",
        uid: me.user_uid,
        username: me.username,
        is_loco_verified: Boolean(me.is_loco_verified),
        is_streamer: me.user_uid === stream?.streamer?.user_uid,
      },
      type: 1,
    };
  } catch {
    return unavailable("website_payload_not_ready");
  }

  let attempted = false;
  let timeoutId;
  try {
    attempted = true;
    const payload = {
      streamId,
      params,
      body: params,
      data: params,
    };
    let result = null;
    let lastReason = "website_transport_failed";
    const candidates = bridge.sendCandidates?.length
      ? bridge.sendCandidates
      : [bridge.send].filter(Boolean);

    for (const sendFn of candidates) {
      try {
        const candidateResult = await Promise.race([
          sendFn(payload),
          new Promise((_, reject) => {
            timeoutId = pageGlobal.setTimeout(
              () => reject(new Error("website_transport_timeout")),
              timeoutMs,
            );
          }),
        ]);
        pageGlobal.clearTimeout(timeoutId);
        const statusCode = Number(candidateResult?.statusCode || (candidateResult?.code === "C10" ? 200 : 0));
        if (candidateResult?.code === "C10" || (statusCode >= 200 && statusCode < 300 && !candidateResult?.error && !candidateResult?.error_code && !candidateResult?.message)) {
          result = candidateResult;
          break;
        }
        lastReason = String(candidateResult?.message || candidateResult?.error_code || candidateResult?.error || `loco_chat_${statusCode}`).slice(0, 240);
      } catch (error) {
        pageGlobal.clearTimeout(timeoutId);
        lastReason = String(error?.message || error || "website_transport_failed").slice(0, 240);
      }
    }

    if (result && (result.code === "C10" || Number(result.statusCode || 200) === 200)) {
      return {
        status: "sent",
        attempted: true,
        provider: "loco-chat-v2",
        providerMessageId: String(result?.data?.id || result?.data?.msgId || params.msgId),
        sentAt: Date.now(),
      };
    }

    return {
      status: "failed",
      attempted: true,
      reason: lastReason,
    };
  } catch (error) {
    pageGlobal.clearTimeout(timeoutId);
    return {
      status: "failed",
      attempted,
      reason: String(error?.message || error || "website_transport_failed").slice(0, 240),
    };
  }
}

export function shouldBlockBrowserResource({ platform = "gosh", resourceType, url }) {
  if (resourceType === "media" || resourceType === "font") return true;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  if (hostname === "static.cloudflareinsights.com") return true;
  if (
    platform === "loco"
    && (
      hostname === "www.googletagmanager.com"
      || hostname === "www.google-analytics.com"
      || hostname === "firebaselogging.googleapis.com"
    )
  ) return true;

  if (
    platform === "loco"
    && /\.(?:m3u8|m4s|ts|mp4)$/.test(pathname)
  ) return true;

  if (
    hostname === "api.vizzlive.com"
    && /\/gosh_admin\/admin\/(?:web_log|log)\//.test(pathname)
  ) return true;

  if (
    hostname === "pull.gosh6.app"
    && (pathname.startsWith("/live/") || /\.(?:m3u8|m4s|ts|flv)$/.test(pathname))
  ) return true;

  if (
    resourceType === "image"
    && /(^|\.)goshcdn\.com$/.test(hostname)
    && (/\/avatar\//.test(pathname) || /\/live\/screenshot\//.test(pathname))
  ) return true;

  return false;
}
