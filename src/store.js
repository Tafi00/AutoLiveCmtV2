import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeChannelUrl, normalizePlatform, platformFromUrl } from "./platforms.js";

export const DEFAULT_STATE = Object.freeze({
  accounts: [],
  messages: [],
  cursor: 0,
  messagesByPlatform: {
    gosh: [],
    loco: [],
  },
  cursorsByPlatform: {
    gosh: 0,
    loco: 0,
  },
  settings: {
    channelUrl: "",
    channelUrls: {
      gosh: "",
      loco: "",
    },
    platform: "gosh",
    delaySeconds: 30,
    displayNames: [],
    renameEveryComments: 1,
  },
  lastSentAt: null,
  commentsSinceRename: 0,
  displayNameCursor: 0,
});

function createDefaultAccount() {
  return {
    id: "default",
    name: "Tài khoản 1",
    profileName: "",
    platform: "gosh",
    enabled: true,
    createdAt: new Date().toISOString(),
  };
}

function cloneDefaultState() {
  const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  state.accounts = [createDefaultAccount()];
  return state;
}

export function normalizeGoshUrl(value, { allowEmpty = true } = {}) {
  return normalizeChannelUrl(value, { allowEmpty, platform: "gosh" });
}

export { normalizeChannelUrl };

export function normalizeChannelUrls(value, legacyChannelUrl = "") {
  const urls = { gosh: "", loco: "" };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const platform of Object.keys(urls)) {
      urls[platform] = normalizeChannelUrl(value[platform], { platform });
    }
  }

  const legacy = String(legacyChannelUrl ?? "").trim();
  if (legacy) {
    const normalized = normalizeChannelUrl(legacy);
    const platform = platformFromUrl(normalized);
    if (platform && !urls[platform]) urls[platform] = normalized;
  }
  return urls;
}

const COMMENT_PLATFORMS = ["gosh", "loco"];

function normalizeStoredMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item.content === "string")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : randomUUID(),
      content: item.content.slice(0, 300),
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    }));
}

function normalizeCursor(value, length, fallback = 0) {
  const cursor = Number.isInteger(value) ? value : fallback;
  return length ? Math.max(0, Math.min(cursor, length - 1)) : 0;
}

export function normalizeDelay(value) {
  const delay = Number(value);
  if (!Number.isInteger(delay) || delay < 0) {
    throw new Error("Thời gian chờ phải là số nguyên lớn hơn hoặc bằng 0 giây.");
  }
  return delay;
}

export function normalizeRenameEveryComments(value) {
  const interval = Number(value);
  if (!Number.isInteger(interval) || interval < 1) {
    throw new Error("Chu kỳ đổi tên phải là số nguyên lớn hơn hoặc bằng 1.");
  }
  return interval;
}

export function normalizeDisplayNames(value) {
  const entries = Array.isArray(value) ? value : String(value ?? "").split(/\r?\n/);
  const names = [...new Set(entries.map((name) => String(name).trim()).filter(Boolean))];
  if (names.some((name) => name.length > 20)) {
    throw new Error("Mỗi tên hiển thị không được vượt quá 20 ký tự.");
  }
  return names;
}

export function normalizeAccountName(value) {
  const name = String(value ?? "").trim();
  if (!name) throw new Error("Tên tài khoản không được để trống.");
  if (name.length > 40) throw new Error("Tên tài khoản không được vượt quá 40 ký tự.");
  return name;
}

export function normalizeMessages(content) {
  const lines = Array.isArray(content)
    ? content
    : String(content ?? "").split(/\r?\n/);
  const items = lines.map((item) => String(item).trim()).filter(Boolean);
  if (!items.length) throw new Error("Nội dung tin nhắn không được để trống.");
  for (const item of items) {
    if (item.length > 300) throw new Error("Mỗi tin nhắn không được vượt quá 300 ký tự.");
  }
  return items;
}

export function normalizeMessage(content) {
  const [first] = normalizeMessages(content);
  return first;
}

function normalizeAccounts(value) {
  if (!Array.isArray(value) || !value.length) return [createDefaultAccount()];

  const accounts = [];
  const usedIds = new Set();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    let name;
    try {
      name = normalizeAccountName(item.name);
    } catch {
      continue;
    }

    let id = typeof item.id === "string" && /^[a-zA-Z0-9_-]+$/.test(item.id)
      ? item.id
      : randomUUID();
    if (usedIds.has(id)) id = randomUUID();
    usedIds.add(id);
    accounts.push({
      id,
      name,
      profileName: typeof item.profileName === "string" ? item.profileName.trim().slice(0, 40) : "",
      platform: normalizePlatform(item.platform, "gosh"),
      enabled: item.enabled !== false,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    });
  }

  if (!accounts.length) return [createDefaultAccount()];
  if (!accounts.some((account) => account.enabled)) accounts[0].enabled = true;
  return accounts;
}

function normalizeState(value) {
  const fallback = cloneDefaultState();
  if (!value || typeof value !== "object") return fallback;

  const legacyMessages = normalizeStoredMessages(value.messages);
  const hasPlatformMessages = value.messagesByPlatform && typeof value.messagesByPlatform === "object"
    && !Array.isArray(value.messagesByPlatform);
  const messagesByPlatform = {
    gosh: normalizeStoredMessages(hasPlatformMessages ? value.messagesByPlatform.gosh : legacyMessages),
    loco: normalizeStoredMessages(hasPlatformMessages ? value.messagesByPlatform.loco : legacyMessages),
  };
  const legacyCursor = Number.isInteger(value.cursor) ? value.cursor : 0;
  const hasPlatformCursors = value.cursorsByPlatform && typeof value.cursorsByPlatform === "object"
    && !Array.isArray(value.cursorsByPlatform);
  const cursorsByPlatform = {
    gosh: normalizeCursor(hasPlatformCursors ? value.cursorsByPlatform.gosh : legacyCursor, messagesByPlatform.gosh.length),
    loco: normalizeCursor(hasPlatformCursors ? value.cursorsByPlatform.loco : legacyCursor, messagesByPlatform.loco.length),
  };

  let channelUrls = { gosh: "", loco: "" };
  try {
    channelUrls = normalizeChannelUrls(value.settings?.channelUrls, value.settings?.channelUrl);
  } catch {
    channelUrls = { gosh: "", loco: "" };
  }
  const platform = normalizePlatform(value.settings?.platform, platformFromUrl(value.settings?.channelUrl) || "gosh");
  const channelUrl = channelUrls[platform] || channelUrls.gosh || channelUrls.loco;

  let delaySeconds = fallback.settings.delaySeconds;
  try {
    delaySeconds = normalizeDelay(value.settings?.delaySeconds);
  } catch {
    delaySeconds = fallback.settings.delaySeconds;
  }

  let displayNames = fallback.settings.displayNames;
  try {
    displayNames = normalizeDisplayNames(value.settings?.displayNames);
  } catch {
    displayNames = fallback.settings.displayNames;
  }

  let renameEveryComments = fallback.settings.renameEveryComments;
  try {
    renameEveryComments = normalizeRenameEveryComments(value.settings?.renameEveryComments);
  } catch {
    renameEveryComments = fallback.settings.renameEveryComments;
  }

  return {
    accounts: normalizeAccounts(value.accounts),
    // `messages` and `cursor` remain as compatibility aliases for older
    // clients; new code reads the per-platform collections below.
    messages: messagesByPlatform.gosh,
    cursor: cursorsByPlatform.gosh,
    messagesByPlatform,
    cursorsByPlatform,
    settings: {
      channelUrl,
      channelUrls,
      platform,
      delaySeconds,
      displayNames,
      renameEveryComments,
    },
    lastSentAt: typeof value.lastSentAt === "string" ? value.lastSentAt : null,
    commentsSinceRename: Number.isInteger(value.commentsSinceRename)
      ? Math.max(0, value.commentsSinceRename)
      : 0,
    displayNameCursor: Number.isInteger(value.displayNameCursor)
      ? Math.max(0, value.displayNameCursor)
      : 0,
  };
}

export class JsonStore {
  constructor(directory) {
    this.directory = directory;
    this.filePath = join(directory, "state.json");
    this.state = cloneDefaultState();
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(this.directory, { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = normalizeState(JSON.parse(raw));
      await this.persist();
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      this.state = cloneDefaultState();
      await this.persist();
    }
    return this.snapshot();
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  getAccount(id) {
    return this.state.accounts.find((account) => account.id === id) || null;
  }

  getEnabledAccounts(platform) {
    return this.state.accounts.filter((account) => account.enabled && (!platform || account.platform === platform));
  }

  async addAccount(name, platform = "gosh") {
    const cleanName = normalizeAccountName(name);
    const cleanPlatform = normalizePlatform(platform);
    if (this.state.accounts.some((account) => account.platform === cleanPlatform && account.name.toLocaleLowerCase("vi") === cleanName.toLocaleLowerCase("vi"))) {
      throw new Error("Tên tài khoản đã tồn tại.");
    }
    const account = {
      id: randomUUID(),
      name: cleanName,
      profileName: "",
      platform: cleanPlatform,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    this.state.accounts.push(account);
    await this.persist();
    return { ...account };
  }

  async updateAccount(id, input = {}) {
    const account = this.getAccount(id);
    if (!account) return null;

    if (Object.hasOwn(input, "name")) {
      const cleanName = normalizeAccountName(input.name);
      const duplicated = this.state.accounts.some((item) => (
        item.id !== id && item.platform === account.platform && item.name.toLocaleLowerCase("vi") === cleanName.toLocaleLowerCase("vi")
      ));
      if (duplicated) throw new Error("Tên tài khoản đã tồn tại.");
      account.name = cleanName;
    }

    if (Object.hasOwn(input, "enabled")) {
      const enabled = Boolean(input.enabled);
      if (!enabled && account.enabled && this.getEnabledAccounts().length === 1) {
        throw new Error("Cần bật ít nhất một tài khoản để gửi.");
      }
      account.enabled = enabled;
    }

    await this.persist();
    return { ...account };
  }

  async updateAccountProfileName(id, value) {
    const account = this.getAccount(id);
    if (!account) return null;
    const profileName = String(value ?? "").trim();
    if (!profileName || profileName.length > 40) return { ...account };
    if (account.profileName === profileName) return { ...account };
    account.profileName = profileName;
    await this.persist();
    return { ...account };
  }

  async deleteAccount(id) {
    const index = this.state.accounts.findIndex((account) => account.id === id);
    if (index < 0) return null;
    if (this.state.accounts.length === 1) {
      throw new Error("Không thể xóa tài khoản cuối cùng.");
    }

    const [deleted] = this.state.accounts.splice(index, 1);
    if (!this.state.accounts.some((account) => account.enabled)) {
      this.state.accounts[0].enabled = true;
    }
    await this.persist();
    return { ...deleted };
  }

  getMessages(platform = "gosh") {
    const cleanPlatform = normalizePlatform(platform);
    return this.state.messagesByPlatform[cleanPlatform];
  }

  getNextMessage(platform = "gosh") {
    const messages = this.getMessages(platform);
    const cursor = this.state.cursorsByPlatform[normalizePlatform(platform)];
    if (!messages.length) return null;
    return messages[cursor % messages.length];
  }

  async addMessage(content, platform = "gosh") {
    const cleanPlatform = normalizePlatform(platform);
    const items = normalizeMessages(content);
    const now = new Date().toISOString();
    const created = [];
    const messages = this.getMessages(cleanPlatform);
    for (const text of items) {
      const message = {
        id: randomUUID(),
        content: text,
        createdAt: now,
      };
      messages.push(message);
      created.push(message);
    }
    this.#syncLegacyMessageAliases();
    await this.persist();
    return created.length === 1 ? created[0] : created;
  }

  async deleteMessage(id, platform = null) {
    const platforms = platform ? [normalizePlatform(platform)] : COMMENT_PLATFORMS;
    let found = null;
    for (const itemPlatform of platforms) {
      const messages = this.getMessages(itemPlatform);
      const index = messages.findIndex((message) => message.id === id);
      if (index >= 0) {
        found = { itemPlatform, messages, index };
        break;
      }
    }
    if (!found) return false;

    const { itemPlatform, messages, index } = found;
    messages.splice(index, 1);
    const currentCursor = this.state.cursorsByPlatform[itemPlatform];
    this.state.cursorsByPlatform[itemPlatform] = messages.length
      ? index < currentCursor ? currentCursor - 1 : Math.min(currentCursor, messages.length - 1)
      : 0;
    this.#syncLegacyMessageAliases();
    await this.persist();
    return true;
  }

  async clearMessages(platform = null) {
    const platforms = platform ? [normalizePlatform(platform)] : COMMENT_PLATFORMS;
    const deletedCount = platforms.reduce((total, itemPlatform) => total + this.getMessages(itemPlatform).length, 0);
    if (!deletedCount) return 0;
    for (const itemPlatform of platforms) {
      this.state.messagesByPlatform[itemPlatform] = [];
      this.state.cursorsByPlatform[itemPlatform] = 0;
    }
    this.#syncLegacyMessageAliases();
    await this.persist();
    return deletedCount;
  }

  async updateSettings(input) {
    const legacyPlatform = platformFromUrl(input.channelUrl);
    const platform = normalizePlatform(input.platform, legacyPlatform || this.state.settings.platform);
    let channelUrls;
    if (Object.hasOwn(input, "channelUrls")) {
      channelUrls = normalizeChannelUrls(input.channelUrls);
    } else {
      channelUrls = normalizeChannelUrls(this.state.settings.channelUrls);
      channelUrls[legacyPlatform || platform] = normalizeChannelUrl(input.channelUrl, {
        platform: legacyPlatform || platform,
      });
    }
    const nextSettings = {
      channelUrl: channelUrls[platform] || channelUrls.gosh || channelUrls.loco,
      channelUrls,
      platform,
      delaySeconds: normalizeDelay(input.delaySeconds),
      displayNames: normalizeDisplayNames(input.displayNames),
      renameEveryComments: normalizeRenameEveryComments(input.renameEveryComments),
    };
    const renameSettingsChanged = nextSettings.renameEveryComments !== this.state.settings.renameEveryComments
      || JSON.stringify(nextSettings.displayNames) !== JSON.stringify(this.state.settings.displayNames);
    this.state.settings = nextSettings;
    if (renameSettingsChanged) {
      this.state.commentsSinceRename = 0;
      this.state.displayNameCursor = 0;
    }
    await this.persist();
    return this.snapshot().settings;
  }

  cooldown() {
    const lastSent = this.state.lastSentAt ? Date.parse(this.state.lastSentAt) : 0;
    const elapsedSeconds = lastSent ? Math.floor((Date.now() - lastSent) / 1000) : Infinity;
    return {
      ready: elapsedSeconds >= this.state.settings.delaySeconds,
      remainingSeconds: Number.isFinite(elapsedSeconds)
        ? Math.max(0, this.state.settings.delaySeconds - elapsedSeconds)
        : 0,
    };
  }

  async markSent({ platforms, platform, countForRename = true } = {}) {
    this.state.lastSentAt = new Date().toISOString();
    if (countForRename) this.state.commentsSinceRename += 1;
    const selectedPlatforms = platforms || (platform ? [platform] : ["gosh"]);
    for (const itemPlatform of [...new Set(selectedPlatforms.map((value) => normalizePlatform(value)))]) {
      const messages = this.getMessages(itemPlatform);
      if (messages.length) {
        this.state.cursorsByPlatform[itemPlatform] = (this.state.cursorsByPlatform[itemPlatform] + 1) % messages.length;
      }
    }
    this.#syncLegacyMessageAliases();
    await this.persist();
  }

  #syncLegacyMessageAliases() {
    this.state.messages = this.state.messagesByPlatform.gosh;
    this.state.cursor = this.state.cursorsByPlatform.gosh;
  }

  shouldRename() {
    const { displayNames, renameEveryComments } = this.state.settings;
    if (!displayNames.length) return false;
    const threshold = Math.max(1, Number(renameEveryComments) || 1);
    return this.state.commentsSinceRename >= threshold;
  }

  getRandomDisplayName(excludeName = "") {
    const { displayNames } = this.state.settings;
    if (!displayNames.length) return null;
    if (displayNames.length === 1) return displayNames[0];

    const cleanExclude = String(excludeName || "").trim().toLowerCase();
    const candidates = displayNames.filter((name) => name.trim().toLowerCase() !== cleanExclude);
    const pool = candidates.length > 0 ? candidates : displayNames;
    const randomIndex = Math.floor(Math.random() * pool.length);
    return pool[randomIndex];
  }

  getPendingDisplayName(excludeName = "") {
    if (!this.shouldRename()) return null;
    return this.getRandomDisplayName(excludeName);
  }

  async markDisplayNameUpdated() {
    this.state.commentsSinceRename = 0;
    this.state.displayNameCursor += 1;
    await this.persist();
  }

  async persist() {
    const payload = `${JSON.stringify(this.state, null, 2)}\n`;
    const temporaryPath = `${this.filePath}.tmp`;
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    await this.writeQueue;
  }
}
