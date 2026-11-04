import assert from "node:assert/strict";
import test from "node:test";
import {
  extractGoshOtpFromText,
  extractGoshTargetUid,
  findNextRegistrableEmail,
  generateEmailVariant,
  generateGoshRegistrationProfile,
  parseGmailAtomEntries,
} from "../src/gosh-otp-reg.js";

test("tạo biến thể email dấu chấm (.) và dấu cộng (+) chuẩn xác từ Gmail gốc", () => {
  assert.equal(
    generateEmailVariant("tafi.user+old@gmail.com", { mode: "dot", index: 1 }),
    "t.afiuser@gmail.com",
  );
  assert.equal(
    generateEmailVariant("tafiuser@gmail.com", { mode: "dot", index: 2 }),
    "ta.fiuser@gmail.com",
  );
  assert.equal(
    generateEmailVariant("tafiuser@gmail.com", { mode: "dot", index: 3 }),
    "t.a.fiuser@gmail.com",
  );
  assert.equal(
    generateEmailVariant("tafi.user@gmail.com", { mode: "plus", index: 5 }),
    "tafiuser+gosh5@gmail.com",
  );
});

test("trích xuất đúng mã OTP 6 chữ số từ tiêu đề hoặc nội dung email Gosh", () => {
  assert.equal(
    extractGoshOtpFromText("Gosh Live: Your verification code is 482910. Valid for 10 minutes (2026)."),
    "482910",
  );
  assert.equal(
    extractGoshOtpFromText("<div>Mã xác minh của bạn là: <b>903157</b></div>"),
    "903157",
  );
  assert.equal(
    extractGoshOtpFromText("Email thông thường năm 2026 không có mã 6 số"),
    "",
  );
});

test("phân tích Gmail Atom XML feed để lấy địa chỉ hộp thư và mã OTP Gosh", () => {
  const sampleAtom = `<?xml version="1.0" encoding="UTF-8"?>
<feed version="0.3" xmlns="http://purl.org/atom/ns#">
  <title>Gmail - Inbox for streamer.test@gmail.com</title>
  <fullcount>1</fullcount>
  <entry>
    <title>Gosh Verification Code</title>
    <summary>Your Gosh verification code is 736281. Please do not share it.</summary>
    <issued>2026-11-03T15:40:00Z</issued>
    <id>tag:gmail.google.com,2004:1999999999</id>
    <author>
      <name>Gosh</name>
      <email>noreply@gosh.com</email>
    </author>
  </entry>
</feed>`;

  const entries = parseGmailAtomEntries(sampleAtom);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].accountEmail, "streamer.test@gmail.com");
  assert.equal(entries[0].isGoshRelated, true);
  assert.equal(entries[0].otp, "736281");
});

test("tạo hồ sơ đăng ký Gosh đáp ứng đầy đủ quy tắc tên, mật khẩu và tuổi", () => {
  const profile = generateGoshRegistrationProfile("ab12cd34");
  assert.match(profile.nickname, /^[A-Za-z0-9_]{6,20}$/);
  assert.doesNotMatch(profile.nickname, /^\d+$/);
  assert.ok(profile.password.length >= 8 && profile.password.length <= 32);
  assert.match(profile.password, /[a-z]/);
  assert.match(profile.password, /[A-Z]/);
  assert.match(profile.password, /\d/);
  assert.match(profile.password, /[^A-Za-z0-9]/);
  assert.match(profile.birthday, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(profile.birthdayUnix > 0);
});

test("tự động bỏ qua biến thể email đã dùng và chọn biến thể đầu tiên Gosh cho phép đăng ký", async () => {
  const checked = [];
  const fakeFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    checked.push(body.account);
    const canRegister = body.account === "t.a.fiuser@gmail.com";
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ code: 0, data: { can_register: canRegister } }),
    };
  };

  const result = await findNextRegistrableEmail("tafiuser@gmail.com", {
    mode: "dot",
    startIndex: 1,
    usedEmails: new Set(["t.afiuser@gmail.com"]),
    fetchImpl: fakeFetch,
  });

  assert.equal(result.email, "t.a.fiuser@gmail.com");
  assert.equal(result.index, 3);
  assert.deepEqual(checked, ["ta.fiuser@gmail.com", "t.a.fiuser@gmail.com"]);
});

test("trích xuất đúng target UID kênh Gosh từ các dạng URL và mã số", () => {
  assert.equal(extractGoshTargetUid("https://gosh.com/vi/16427037"), "16427037");
  assert.equal(extractGoshTargetUid("https://gosh6.app/15942759"), "15942759");
  assert.equal(extractGoshTargetUid("16427037"), "16427037");
  assert.equal(extractGoshTargetUid("https://example.com/"), "");
});
