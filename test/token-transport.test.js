import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import {
  credentialsFromCookies,
  GaquaytvChatSocket,
  goshChatPayload,
  goshChatUser,
  goshSignature,
  locoSendComment,
  resolveGaquaytvRoom,
  resolveGoshRoom,
} from "../src/token-transport.js";
import { fakeFetch, FakeWebSocket } from "./fakes.js";

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

test("đọc token từ cookie profile cho từng website", () => {
  assert.deepEqual(credentialsFromCookies("gaquaytv", [
    { domain: "gaquaytv.com", name: "access_token", value: "gq-access" },
    { domain: "gaquaytv.com", name: "refresh_token", value: "gq-refresh" },
  ]), { accessToken: "gq-access", refreshToken: "gq-refresh" });

  const locoAccess = jwt({ device_id: "device-live", user_uid: "UID1", username: "loco_user" });
  assert.deepEqual(credentialsFromCookies("loco", [
    { domain: ".loco11.com", name: "access_token", value: "retired-domain-token" },
    { domain: ".loco.com", name: "access_token", value: locoAccess },
    { domain: ".loco.com", name: "refresh_token", value: "loco-refresh" },
  ]), { accessToken: locoAccess, refreshToken: "loco-refresh", deviceId: "device-live" });

  const goshCookies = [
    { domain: ".gosh.com", name: "token", value: "gosh-token" },
    { domain: ".gosh.com", name: "uid", value: "123" },
    { domain: ".gosh.com", name: "did", value: "device" },
    { domain: ".gosh.com", name: "ctry", value: "vn" },
  ];
  // A visitor session has no IM signature and cannot chat.
  assert.equal(credentialsFromCookies("gosh", goshCookies), null);
  assert.deepEqual(credentialsFromCookies("gosh", [
    ...goshCookies,
    { domain: ".gosh.com", name: "tim_user_sig", value: "sig" },
  ]), { token: "gosh-token", uid: "123", did: "device", ctry: "vn", timUserSig: "sig" });
});

test("ký request Gosh theo thứ tự khóa và băm body POST", () => {
  const body = JSON.stringify({ anchor_ids: ["1"] });
  const expected = createHmac("sha256", "A7fQ9K2mX8Zp4R3L")
    .update(`body=${createHash("sha256").update(body).digest("hex")}&did=d&method=POST&path=/x&ts=10&uid=5`)
    .digest("hex");
  assert.equal(goshSignature({ did: "d", uid: "5", ts: "10", method: "POST", path: "/x", body }), expected);
});

test("payload chat Gosh bỏ thông tin đăng nhập và dùng tên vừa đổi", () => {
  const user = goshChatUser({ id: 1, nickname: "Cũ", tim_user_sig: "secret", ip: "1.2.3.4", avatar: "a.png" }, "Tên Mới");
  assert.deepEqual(user, { id: 1, nickname: "Tên Mới", avatar: "a.png" });
  const payload = JSON.parse(goshChatPayload({ user, liveId: "live-1", content: "Xin chào" }));
  assert.equal(payload.type, 10_000);
  assert.equal(payload.live_id, "live-1");
  assert.deepEqual(payload.data, { text: "Xin chào", rich_content: [{ type: "text", text: "Xin chào" }] });
  assert.equal(payload.client_request_id, payload.trace_id);
});

test("tìm phòng chat Gosh từ id streamer trong URL", async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({
    body: { code: 0, data: { lives: [{ id: "6877", im_room: "@AVC#15118531" }] } },
  }));
  const room = await resolveGoshRoom("https://gosh.com/vi/15118531", { fetchImpl });
  assert.deepEqual(room, { anchorId: "15118531", liveId: "6877", groupId: "@AVC#15118531" });
  assert.match(calls[0].url, /^https:\/\/api\.gosh\.com\/gosh_base\/app\/live\/batch_get_by_anchor\?/);
  assert.equal(calls[0].body, JSON.stringify({ anchor_ids: ["15118531"] }));
  assert.ok(calls[0].headers["x-signature"]);
});

test("tìm mã phòng GaQuayTV từ link slug", async () => {
  const roomId = "fc51a33f-56a9-4238-8551-5dc56dde79b1";
  assert.equal(await resolveGaquaytvRoom(`https://gaquaytv.com/live/${roomId}`), roomId);
  const { fetchImpl } = fakeFetch(() => ({
    body: `<script>self.__next_f.push([1,"{\\"roomId\\":\\"${roomId}\\",\\"giftcode\\":{}}"])</script>`,
  }));
  assert.equal(await resolveGaquaytvRoom("https://gaquaytv.com/live/livestream-abc-6dde79b1", { fetchImpl }), roomId);
});

test("socket GaQuayTV gửi token, vào phòng và xác nhận qua tin phản hồi", async () => {
  FakeWebSocket.instances = [];
  const socket = new GaquaytvChatSocket({ token: "gq-access", WebSocketImpl: FakeWebSocket });
  await socket.connect();
  const ws = FakeWebSocket.instances[0];
  assert.equal(ws.options.headers.origin, "https://gaquaytv.com");
  assert.equal(ws.sent[0], '40{"token":"gq-access"}');

  ws.receive("2");
  assert.equal(ws.sent.at(-1), "3");

  ws.onEmit = (event, payload) => {
    if (event !== "send_message") return;
    queueMicrotask(() => ws.receive(`42${JSON.stringify(["onReceiveMessage", {
      room: payload.room,
      msgs: [{ username: "gq_user", content: payload.data.msgs[0].content }],
    }])}`));
  };
  const result = await socket.sendChat({
    room: "room-1",
    content: "<b>Chào</b> & vui",
    sender: { displayName: "GQ", username: "gq_user", avatar: "" },
  });
  assert.deepEqual(result, { confirmed: true });
  const emitted = ws.sent.filter((packet) => packet.startsWith("42")).map((packet) => JSON.parse(packet.slice(2)));
  assert.deepEqual(emitted[0], ["join_room", { room: "room-1" }]);
  assert.equal(emitted[1][0], "send_message");
  assert.equal(emitted[1][1].data.msgs[0].content, '<div class="!inline">&lt;b&gt;Chào&lt;/b&gt; &amp; vui</div>');
  assert.equal(emitted[1][1].data.msgs[0].sender_name, "GQ");

  ws.onEmit = (event) => {
    if (event === "send_message") queueMicrotask(() => ws.receive('42["onErrorMessage",{"message":"spam"}]'));
  };
  await assert.rejects(
    socket.sendChat({ room: "room-1", content: "lần 2", sender: { displayName: "GQ", username: "gq_user" } }),
    /GaQuayTV từ chối bình luận: spam/,
  );
  // Joined rooms are not joined again.
  assert.equal(ws.sent.filter((packet) => packet.includes("join_room")).length, 1);
  socket.close();
});

test("gửi chat Loco bằng token và báo AUTH_EXPIRED khi token bị từ chối", async () => {
  const accessToken = jwt({ user_uid: "UID1", username: "loco_user", avatar: "a.png", device_id: "dev" });
  const { fetchImpl, calls } = fakeFetch(() => ({ body: { code: "C10", data: { id: "msg-1" } } }));
  const result = await locoSendComment({
    streamId: "stream-1",
    content: "Xin chào",
    credentials: { accessToken, deviceId: "dev" },
    sessionUid: "session",
    fetchImpl,
  });
  assert.deepEqual(result, { providerMessageId: "msg-1" });
  assert.equal(calls[0].url, "https://api.loco.com/chat/v2/streams/stream-1/chat/?send=true");
  assert.equal(calls[0].headers.authorization, accessToken);
  assert.equal(calls[0].headers["x-platform"], "7");
  const body = JSON.parse(calls[0].body);
  assert.equal(body.message, "Xin chào");
  assert.equal(body.deviceId, "dev-session");
  assert.deepEqual(
    { uid: body.profile.uid, username: body.profile.username },
    { uid: "UID1", username: "loco_user" },
  );

  const rejected = fakeFetch(() => ({ status: 401, body: { error_code: "E005" } }));
  await assert.rejects(
    locoSendComment({ streamId: "s", content: "x", credentials: { accessToken }, sessionUid: "s", fetchImpl: rejected.fetchImpl }),
    { code: "AUTH_EXPIRED" },
  );
});
