// Một "mắt xem": 1 socket socket.io vào group livestream, protocol msgpack
// riêng của royalcloud. Đã đối chiếu frame thật của trình duyệt:
//   text "0{\"sid\":..}"  -> engine.io open
//   bin  {type:0,data:{token:""},nsp:"/livestream"}          -> CONNECT
//   bin  {type:2,data:["JoinGroup",hub,null,fp],options:{compress:true},nsp:"/livestream"}
//   text "2" -> "3"                                          -> ping/pong
import WebSocket from "ws";
import crypto from "node:crypto";
import { encode, decode } from "@msgpack/msgpack";

export const NSP = "/livestream";
const HANDSHAKE_TIMEOUT = 15000;
const DEAD_MS = 70000;

export function newFingerprint() {
  return crypto.randomBytes(16).toString("hex");
}

export class Viewer {
  #config;
  #ws = null;
  #stopped = false;
  #attempt = 0;
  #joined = false;
  #lastRx = 0;
  #watchdog = null;
  #hooks;

  constructor({ platform, hub, userAgent, agent, fingerprint, onJoin, onDrop, onCount, onError }) {
    this.#config = { platform, hub, userAgent, agent };
    this.#hooks = { onJoin, onDrop, onCount, onError };
    this.fp = fingerprint || newFingerprint();
  }

  get connected() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  get joined() {
    return this.#joined;
  }

  start() {
    this.#stopped = false;
    this.#connect();
    return this;
  }

  stop() {
    this.#stopped = true;
    clearInterval(this.#watchdog);
    try {
      this.#ws?.close(1000, "shutdown");
    } catch {
      // socket đã chết
    }
  }

  #connect() {
    const { platform, hub, userAgent, agent } = this.#config;
    const ws = new WebSocket(platform.socketUrl, {
      headers: {
        Origin: platform.origin,
        "User-Agent": userAgent,
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
      },
      agent,
      perMessageDeflate: false,
      maxPayload: 2 * 1024 * 1024,
      handshakeTimeout: HANDSHAKE_TIMEOUT,
    });
    this.#ws = ws;

    ws.on("open", () => {
      this.#lastRx = Date.now();
      clearInterval(this.#watchdog);
      this.#watchdog = setInterval(() => {
        if (this.connected && Date.now() - this.#lastRx > DEAD_MS) ws.terminate();
      }, 5000);
      this.#watchdog.unref?.();
    });

    ws.on("message", (data, isBinary) => {
      this.#lastRx = Date.now();
      if (!isBinary) {
        const text = data.toString();
        if (text === "2") return ws.send("3");
        if (text.startsWith("0")) this.#send({ type: 0, data: { token: "" }, nsp: NSP });
        return;
      }
      let packet;
      try {
        packet = decode(data);
      } catch {
        return;
      }
      if (packet.type === 0) {
        this.#send({
          type: 2,
          data: ["JoinGroup", hub, null, this.fp],
          options: { compress: true },
          nsp: NSP,
        });
      } else if (packet.type === 2) {
        const [event, ...args] = packet.data || [];
        if (event === "CallerJoinGroup") {
          this.#attempt = 0;
          this.#joined = true;
          this.#hooks.onJoin?.(this);
        } else if (event === "CallerTokenInvalid" || event === "CallerTokenRevoked") {
          this.#hooks.onError?.(new Error(event));
        } else if (event === "RecvViewer") {
          const count = Number(args[0]);
          if (Number.isFinite(count)) this.#hooks.onCount?.(count);
        }
      }
    });

    ws.on("close", () => {
      clearInterval(this.#watchdog);
      if (this.#joined) {
        this.#joined = false;
        this.#hooks.onDrop?.(this);
      }
      if (!this.#stopped) this.#backoff();
    });

    ws.on("error", (error) => this.#hooks.onError?.(error));
  }

  #send(packet) {
    if (this.connected) this.#ws.send(encode(packet));
  }

  #backoff() {
    this.#attempt = Math.min(this.#attempt + 1, 7);
    const delay = Math.min(60000, 800 * 2 ** this.#attempt) + Math.random() * 1500;
    const timer = setTimeout(() => {
      if (!this.#stopped) this.#connect();
    }, delay);
    timer.unref?.();
  }
}
