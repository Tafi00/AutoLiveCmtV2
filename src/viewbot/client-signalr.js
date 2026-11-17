// Mắt xem cho site dùng SignalR + MessagePack hub protocol (mb66).
// Hub: https://live-mb66-apiws.attcloud.org/livestream
// JoinGroup(hub, token, fingerprint) -> CallerJoinGroup "Ok", server đẩy RecvViewer.
import WebSocket from "ws";
import crypto from "node:crypto";
import { HubConnectionBuilder, HttpTransportType, LogLevel } from "@microsoft/signalr";
import { MessagePackHubProtocol } from "@microsoft/signalr-protocol-msgpack";

export function newFingerprint() {
  return crypto.randomBytes(16).toString("hex");
}

// ws subclass so each viewer can carry its own proxy agent + browser headers
function webSocketClass({ origin, userAgent, agent }) {
  return class ProxiedWebSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, {
        headers: { Origin: origin, "User-Agent": userAgent },
        agent,
        perMessageDeflate: false,
        maxPayload: 2 * 1024 * 1024,
      });
    }
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class SignalRViewer {
  #config;
  #connection = null;
  #stopped = false;
  #attempt = 0;
  #joined = false;
  #lastRx = 0;
  #hooks;

  constructor({ platform, hub, userAgent, agent, fingerprint, onJoin, onDrop, onCount, onError }) {
    this.#config = { platform, hub, userAgent, agent };
    this.#hooks = { onJoin, onDrop, onCount, onError };
    this.fp = fingerprint || newFingerprint();
  }

  get connected() {
    return Boolean(this.#connection && this.#connection.state === "Connected");
  }

  get joined() {
    return this.#joined;
  }

  start() {
    this.#stopped = false;
    void this.#run();
    return this;
  }

  stop() {
    this.#stopped = true;
    try {
      void this.#connection?.stop();
    } catch {
      // kết nối đã đóng
    }
  }

  #running = false;

  async #run() {
    if (this.#running) return;
    this.#running = true;
    try {
      while (!this.#stopped) {
        try {
          await this.#connect();
          return;
        } catch (error) {
          this.#hooks.onError?.(error);
          this.#attempt = Math.min(this.#attempt + 1, 7);
          await sleep(Math.min(60000, 800 * 2 ** this.#attempt) + Math.random() * 1500);
        }
      }
    } finally {
      this.#running = false;
    }
  }

  async #connect() {
    const { platform, hub, userAgent, agent } = this.#config;
    const url = `${platform.socketUrl}?timestamp=${Date.now()}`;
    const connection = new HubConnectionBuilder()
      .withUrl(url, {
        transport: HttpTransportType.WebSockets,
        skipNegotiation: true,
        withCredentials: false,
        headers: { Origin: platform.origin, "User-Agent": userAgent },
        WebSocket: webSocketClass({ origin: platform.origin, userAgent, agent }),
      })
      .withHubProtocol(new MessagePackHubProtocol())
      .configureLogging(LogLevel.None)
      .build();
    this.#connection = connection;

    connection.on("RecvViewer", (count) => {
      this.#lastRx = Date.now();
      const value = Number(count);
      if (Number.isFinite(value)) this.#hooks.onCount?.(value);
    });
    connection.on("RecvChat", () => {
      this.#lastRx = Date.now();
    });
    connection.on("CallerTokenInvalid", () => this.#hooks.onError?.(new Error("CallerTokenInvalid")));
    connection.on("CallerTokenRevoked", () => this.#hooks.onError?.(new Error("CallerTokenRevoked")));
    connection.onclose(() => {
      if (this.#joined) {
        this.#joined = false;
        this.#hooks.onDrop?.(this);
      }
      if (!this.#stopped) void this.#run();
    });

    await connection.start();
    this.#lastRx = Date.now();
    await connection.invoke("JoinGroup", hub, "", this.fp);
    this.#attempt = 0;
    this.#joined = true;
    this.#hooks.onJoin?.(this);
  }
}

export const createSignalRViewer = (options) => new SignalRViewer(options);
