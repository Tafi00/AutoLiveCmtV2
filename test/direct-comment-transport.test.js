import assert from "node:assert/strict";
import test from "node:test";
import {
  sendCommentViaLocoTransport,
  sendCommentViaWebsiteTransport,
  shouldBlockBrowserResource,
} from "../src/direct-comment-transport.js";

function createStore(state) {
  const store = () => state;
  store.getState = () => state;
  return store;
}

function serializedWebsiteTransport() {
  return Function(`return (${sendCommentViaWebsiteTransport.toString()})`)();
}

function serializedLocoTransport() {
  return Function(`return (${sendCommentViaLocoTransport.toString()})`)();
}

function createWebpackFixture({ sendImpl }) {
  const moduleFactories = {};
  const moduleCache = {};
  const runtimeRequire = (moduleId) => {
    if (!moduleCache[moduleId]) {
      const record = { exports: {} };
      moduleCache[moduleId] = record;
      moduleFactories[moduleId](record, record.exports, runtimeRequire);
    }
    return moduleCache[moduleId].exports;
  };
  runtimeRequire.m = moduleFactories;

  moduleFactories.send = function sendFactory(module, exports) {
    void "chat_target_group_missing payloadData client_request_id";
    exports.send = async function websiteSend({ groupId, payloadData }) {
      void "chat_target_group_missing";
      return sendImpl({ groupId, payloadData });
    };
  };
  moduleFactories.account = function accountFactory(module, exports) {
    void "setAuthenticatedAccount refreshAccount sessionRevision";
    exports.store = createStore({
      account: {
        id: 42,
        nickname: "Tài khoản thử",
        avatar: "avatar.png",
        tim_user_sig: "must-not-leak",
      },
      loginType: 2,
      sessionRevision: "revision",
    });
  };
  moduleFactories.live = function liveFactory(module, exports) {
    void "anchorSensitiveWords fetchJoinRoom currentLive";
    exports.store = createStore({
      anchorInfo: { live_info: { live_id: 777, im_room: "room-777" } },
      currentLive: { id: 777, im_room: "room-777" },
      liveRoom: { live: { id: 777, im_room: "room-777" } },
      liveRoomData: {},
    });
  };
  moduleFactories.sanitizer = function sanitizerFactory(module, exports) {
    void "tim_user_sig is_show_transfer last_login_at";
    exports.sanitize = function sanitizeAccount(account) {
      void "tim_user_sig is_show_transfer";
      const clean = { ...account };
      delete clean.tim_user_sig;
      return clean;
    };
  };

  const chunkQueue = [];
  chunkQueue.push = (chunk) => {
    const [, newModules, runtime] = chunk;
    Object.assign(moduleFactories, newModules);
    runtime?.(runtimeRequire);
    return chunkQueue.length;
  };
  return chunkQueue;
}

function createLocoWebpackFixture({
  sendImpl,
  includeEmptyStreamCollision = false,
  includeBodyVariantCollision = false,
}) {
  const moduleFactories = {};
  const moduleCache = {};
  const runtimeRequire = (moduleId) => {
    if (!moduleCache[moduleId]) {
      const record = { exports: {} };
      moduleCache[moduleId] = record;
      moduleFactories[moduleId](record, record.exports, runtimeRequire);
    }
    return moduleCache[moduleId].exports;
  };
  runtimeRequire.m = moduleFactories;

  moduleFactories.chat = function locoChatFactory(module, exports) {
    void "/chat/?send=true X-CLIENT-ID X-CLIENT-SECRET";
    if (includeBodyVariantCollision) {
      exports.bodyVariant = async function locoChatBody({ streamId, body }) {
        const websiteClient = { post() {} };
        websiteClient.post();
        void "/chat/?send=true X-CLIENT-ID";
        return sendImpl({ streamId, body, selectedWrongVariant: true });
      };
    }
    exports.send = async function locoChatSend({ streamId, params }) {
      const websiteClient = { post() {} };
      websiteClient.post();
      void "/chat/?send=true X-CLIENT-ID";
      return sendImpl({ streamId, params });
    };
  };
  moduleFactories.fingerprint = function fingerprintFactory(module, exports) {
    const marker = "fixture";
    marker.endsWith("live");
    void "fingerprint x64hash128";
    exports.getFingerprint = async function getFingerprint() {
      const fingerprint = "fixture-fingerprint-live";
      return fingerprint.endsWith("live") ? fingerprint : `${fingerprint}live`;
    };
  };
  moduleFactories.user = function locoUserFactory(module, exports) {
    void "setAccessToken refreshToken isSignUp";
    exports.store = createStore({
      me: {
        user_uid: "user-1",
        username: "Tài khoản Loco",
        avatar_url: "avatar.png",
        is_loco_verified: true,
      },
      accessToken: "not-exported",
      setAccessToken() {},
      refreshToken: "not-exported",
    });
  };
  moduleFactories.stream = function locoStreamFactory(module, exports) {
    void "followDelayRunningTimer setSlowModeTime isChatTimeStamps";
    exports.store = createStore({
      stream: {
        uid: "stream-1",
        streamer: { user_uid: "streamer-1" },
      },
      isModerator: 10,
      slowModeTime: 5,
    });
  };
  if (includeEmptyStreamCollision) {
    // Loco currently ships another matching store factory before the hydrated
    // stream store. Discovery must continue until it finds the active room.
    moduleFactories["000-empty-stream"] = function emptyLocoStreamFactory(module, exports) {
      void "followDelayRunningTimer setSlowModeTime isChatTimeStamps";
      exports.store = createStore({
        stream: undefined,
        isModerator: 0,
        slowModeTime: 0,
      });
    };
  }
  moduleFactories.app = function locoAppFactory(module, exports) {
    void "sessionUid requestCountryCode setAppLanguage";
    exports.store = createStore({
      sessionUid: "session-1",
      appLanguage: "vi",
      requestCountryCode: "VN",
    });
  };

  const chunkQueue = [];
  chunkQueue.push = (chunk) => {
    const [, newModules, runtime] = chunk;
    Object.assign(moduleFactories, newModules);
    runtime?.(runtimeRequire);
    return chunkQueue.length;
  };
  return chunkQueue;
}

test("gửi trực tiếp bằng transport của website và loại thông tin đăng nhập khỏi payload", async () => {
  const previousQueue = globalThis.webpackChunk_N_E;
  const previousBridge = globalThis.__goshCommentAssistantDirectTransportV1;
  let sent;
  globalThis.webpackChunk_N_E = createWebpackFixture({
    sendImpl: async (input) => {
      sent = input;
      return { provider: "tencent", providerMessageId: "message-1", sentAt: 1_780_000_000_000 };
    },
  });
  delete globalThis.__goshCommentAssistantDirectTransportV1;

  try {
    const result = await serializedWebsiteTransport()({ content: "  Xin chào  ", timeoutMs: 2_000 });
    assert.equal(result.status, "sent");
    assert.equal(result.provider, "tencent");
    assert.equal(sent.groupId, "room-777");

    const payload = JSON.parse(sent.payloadData);
    assert.equal(payload.data.text, "Xin chào");
    assert.equal(payload.live_id, 777);
    assert.equal(payload.user.nickname, "Tài khoản thử");
    assert.equal("tim_user_sig" in payload.user, false);
  } finally {
    if (previousQueue === undefined) delete globalThis.webpackChunk_N_E;
    else globalThis.webpackChunk_N_E = previousQueue;
    if (previousBridge === undefined) delete globalThis.__goshCommentAssistantDirectTransportV1;
    else globalThis.__goshCommentAssistantDirectTransportV1 = previousBridge;
  }
});

test("transport Gosh dùng tên vừa đổi thay vì nickname còn lưu trong store của trang", async () => {
  const previousQueue = globalThis.webpackChunk_N_E;
  const previousBridge = globalThis.__goshCommentAssistantDirectTransportV1;
  let sent;
  globalThis.webpackChunk_N_E = createWebpackFixture({
    sendImpl: async (input) => {
      sent = input;
      return { provider: "tencent" };
    },
  });
  delete globalThis.__goshCommentAssistantDirectTransportV1;

  try {
    const result = await serializedWebsiteTransport()({
      content: "Tên mới",
      displayName: "Tên đã đổi",
      timeoutMs: 2_000,
    });
    assert.equal(result.status, "sent");
    assert.equal(JSON.parse(sent.payloadData).user.nickname, "Tên đã đổi");
  } finally {
    if (previousQueue === undefined) delete globalThis.webpackChunk_N_E;
    else globalThis.webpackChunk_N_E = previousQueue;
    if (previousBridge === undefined) delete globalThis.__goshCommentAssistantDirectTransportV1;
    else globalThis.__goshCommentAssistantDirectTransportV1 = previousBridge;
  }
});

test("không yêu cầu UI fallback sau khi transport realtime đã bắt đầu gửi", async () => {
  const previousQueue = globalThis.webpackChunk_N_E;
  const previousBridge = globalThis.__goshCommentAssistantDirectTransportV1;
  globalThis.webpackChunk_N_E = createWebpackFixture({
    sendImpl: async () => {
      throw new Error("ack_lost");
    },
  });
  delete globalThis.__goshCommentAssistantDirectTransportV1;

  try {
    const result = await serializedWebsiteTransport()({ content: "Không gửi trùng", timeoutMs: 2_000 });
    assert.equal(result.status, "failed");
    assert.equal(result.attempted, true);
    assert.match(result.reason, /ack_lost/);
  } finally {
    if (previousQueue === undefined) delete globalThis.webpackChunk_N_E;
    else globalThis.webpackChunk_N_E = previousQueue;
    if (previousBridge === undefined) delete globalThis.__goshCommentAssistantDirectTransportV1;
    else globalThis.__goshCommentAssistantDirectTransportV1 = previousBridge;
  }
});

test("gửi comment Loco qua Chat V2 HTTPS bằng payload của website", async () => {
  const previousQueue = globalThis.webpackChunk_N_E;
  const previousBridge = globalThis.__locoCommentAssistantDirectTransportV1;
  let sent;
  globalThis.webpackChunk_N_E = createLocoWebpackFixture({
    includeEmptyStreamCollision: true,
    includeBodyVariantCollision: true,
    sendImpl: async (input) => {
      sent = input;
      return { code: "C10", statusCode: 200, data: { msgId: "server-message-1" } };
    },
  });
  delete globalThis.__locoCommentAssistantDirectTransportV1;

  try {
    const result = await serializedLocoTransport()({ content: "  Chào Loco  ", timeoutMs: 2_000 });
    assert.equal(result.status, "sent");
    assert.equal(result.provider, "loco-chat-v2");
    assert.equal(result.providerMessageId, "server-message-1");
    assert.equal(sent.streamId, "stream-1");
    assert.equal(sent.params.message, "Chào Loco");
    assert.equal(sent.params.deviceId, "fixture-fingerprint-live-session-1");
    assert.equal(sent.params.moderator_type, 10);
    assert.equal(sent.params.profile.username, "Tài khoản Loco");
    assert.equal("accessToken" in sent.params, false);
  } finally {
    if (previousQueue === undefined) delete globalThis.webpackChunk_N_E;
    else globalThis.webpackChunk_N_E = previousQueue;
    if (previousBridge === undefined) delete globalThis.__locoCommentAssistantDirectTransportV1;
    else globalThis.__locoCommentAssistantDirectTransportV1 = previousBridge;
  }
});

test("transport Loco dùng username vừa đổi thay vì hồ sơ cũ trong store của trang", async () => {
  const previousQueue = globalThis.webpackChunk_N_E;
  const previousBridge = globalThis.__locoCommentAssistantDirectTransportV1;
  let sent;
  globalThis.webpackChunk_N_E = createLocoWebpackFixture({
    sendImpl: async (input) => {
      sent = input;
      return { code: "C10", statusCode: 200 };
    },
  });
  delete globalThis.__locoCommentAssistantDirectTransportV1;

  try {
    const result = await serializedLocoTransport()({
      content: "Tên mới",
      displayName: "Tên đã đổi",
      timeoutMs: 2_000,
    });
    assert.equal(result.status, "sent");
    assert.equal(sent.params.profile.username, "Tên đã đổi");
  } finally {
    if (previousQueue === undefined) delete globalThis.webpackChunk_N_E;
    else globalThis.webpackChunk_N_E = previousQueue;
    if (previousBridge === undefined) delete globalThis.__locoCommentAssistantDirectTransportV1;
    else globalThis.__locoCommentAssistantDirectTransportV1 = previousBridge;
  }
});

test("không fallback sang UI khi request HTTPS của Loco đã được gọi", async () => {
  const previousQueue = globalThis.webpackChunk_N_E;
  const previousBridge = globalThis.__locoCommentAssistantDirectTransportV1;
  globalThis.webpackChunk_N_E = createLocoWebpackFixture({
    sendImpl: async () => ({ code: "C11", statusCode: 400, message: "slow_mode" }),
  });
  delete globalThis.__locoCommentAssistantDirectTransportV1;

  try {
    const result = await serializedLocoTransport()({ content: "Không gửi trùng", timeoutMs: 2_000 });
    assert.equal(result.status, "failed");
    assert.equal(result.attempted, true);
    assert.equal(result.reason, "slow_mode");
  } finally {
    if (previousQueue === undefined) delete globalThis.webpackChunk_N_E;
    else globalThis.webpackChunk_N_E = previousQueue;
    if (previousBridge === undefined) delete globalThis.__locoCommentAssistantDirectTransportV1;
    else globalThis.__locoCommentAssistantDirectTransportV1 = previousBridge;
  }
});

test("chặn video và tài nguyên nền nhưng giữ API/JavaScript chat", () => {
  assert.equal(shouldBlockBrowserResource({
    resourceType: "xhr",
    url: "https://pull.gosh6.app/live/channel.m3u8?signature=redacted",
  }), true);
  assert.equal(shouldBlockBrowserResource({
    resourceType: "media",
    url: "https://example.com/video.mp4",
  }), true);
  assert.equal(shouldBlockBrowserResource({
    resourceType: "image",
    url: "https://static.goshcdn.com/_ugc/avatar/example.png",
  }), true);
  assert.equal(shouldBlockBrowserResource({
    resourceType: "script",
    url: "https://static.goshcdn.com/fe_live/gosh/prod/chat-sdk.js",
  }), false);
  assert.equal(shouldBlockBrowserResource({
    resourceType: "fetch",
    url: "https://api.gosh6.app/gosh_base/app/live/join",
  }), false);
  assert.equal(shouldBlockBrowserResource({
    platform: "loco",
    resourceType: "xhr",
    url: "https://video.example.net/live/channel.m3u8?token=redacted",
  }), true);
  assert.equal(shouldBlockBrowserResource({
    platform: "loco",
    resourceType: "script",
    url: "https://www.googletagmanager.com/gtm.js?id=redacted",
  }), true);
  assert.equal(shouldBlockBrowserResource({
    platform: "loco",
    resourceType: "fetch",
    url: "https://api.loco.com/chat/v2/streams/stream-1/chat/?send=true",
  }), false);
  assert.equal(shouldBlockBrowserResource({
    platform: "loco",
    resourceType: "websocket",
    url: "wss://cf-mqtt-ws.getloconow.com/mqtt",
  }), false);
});
