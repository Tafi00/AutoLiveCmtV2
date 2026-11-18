// Đẩy dữ liệu realtime cho mọi thiết bị qua Server-Sent Events.
// Mỗi "topic" có một hàm build; server chỉ build lại khi có thay đổi (invalidate)
// và chỉ gửi khi nội dung khác lần trước — nhiều thiết bị dùng chung một lần tính.

const HEARTBEAT_MS = 20000;

export class Realtime {
  #clients = new Set();
  #topics = new Map();
  #heartbeat = null;
  #ticker = null;

  register(name, build, { throttleMs = 250, liveWhile = null, liveEveryMs = 2000 } = {}) {
    this.#topics.set(name, {
      name,
      build,
      throttleMs,
      liveWhile,
      liveEveryMs,
      lastLive: 0,
      text: "",
      version: 0,
      timer: null,
      building: false,
      dirty: true,
    });
    return this;
  }

  get clientCount() {
    return this.#clients.size;
  }

  // đánh dấu topic cần build lại; gộp nhiều lần gọi gần nhau thành một lần build
  invalidate(...names) {
    const list = names.length ? names : [...this.#topics.keys()];
    for (const name of list) {
      const topic = this.#topics.get(name);
      if (!topic) continue;
      topic.dirty = true;
      if (!this.#clients.size || topic.timer || topic.building) continue;
      topic.timer = setTimeout(() => {
        topic.timer = null;
        void this.#rebuild(topic);
      }, topic.throttleMs);
      topic.timer.unref?.();
    }
  }

  // gửi thẳng payload đã có sẵn (không qua build)
  publish(name, payload) {
    let topic = this.#topics.get(name);
    if (!topic) {
      this.register(name, async () => payload);
      topic = this.#topics.get(name);
    }
    const text = JSON.stringify(payload);
    topic.dirty = false;
    if (text === topic.text) return;
    topic.text = text;
    topic.version += 1;
    this.#broadcast(this.#frame(name, text));
  }

  async #rebuild(topic) {
    if (topic.building) {
      topic.dirty = true;
      return;
    }
    topic.building = true;
    topic.dirty = false;
    try {
      const payload = await topic.build();
      if (payload !== undefined) {
        const text = JSON.stringify(payload);
        if (text !== topic.text) {
          topic.text = text;
          topic.version += 1;
          this.#broadcast(this.#frame(topic.name, text));
        }
      }
    } catch (error) {
      console.warn(`[realtime] build ${topic.name} lỗi: ${error.message}`);
    } finally {
      topic.building = false;
      if (topic.dirty && this.#clients.size) this.invalidate(topic.name);
    }
  }

  #frame(name, text) {
    return `event: ${name}\ndata: ${text}\n\n`;
  }

  #broadcast(frame) {
    for (const client of this.#clients) this.#write(client, frame);
  }

  #write(client, frame) {
    try {
      client.write(frame);
    } catch {
      this.#clients.delete(client);
    }
  }

  #startTimers() {
    if (this.#heartbeat) return;
    this.#heartbeat = setInterval(() => this.#broadcast(`: ping ${Date.now()}\n\n`), HEARTBEAT_MS);
    this.#heartbeat.unref?.();
    // topic nào đang có tiến trình chạy thì tự làm mới định kỳ
    this.#ticker = setInterval(() => {
      if (!this.#clients.size) return;
      const now = Date.now();
      for (const topic of this.#topics.values()) {
        if (!topic.liveWhile || now - topic.lastLive < topic.liveEveryMs) continue;
        let live = false;
        try {
          live = Boolean(topic.liveWhile());
        } catch {
          live = false;
        }
        if (!live) continue;
        topic.lastLive = now;
        this.invalidate(topic.name);
      }
    }, 500);
    this.#ticker.unref?.();
  }

  #stopTimersIfIdle() {
    if (this.#clients.size) return;
    clearInterval(this.#heartbeat);
    clearInterval(this.#ticker);
    this.#heartbeat = null;
    this.#ticker = null;
  }

  handler() {
    return async (request, response) => {
      response.status(200);
      response.set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders?.();
      request.socket?.setKeepAlive?.(true);
      request.socket?.setNoDelay?.(true);
      request.socket?.setTimeout?.(0);
      response.write(`retry: 2000\n: hello\n\n`);
      this.#clients.add(response);
      this.#startTimers();
      request.on("close", () => {
        this.#clients.delete(response);
        this.#stopTimersIfIdle();
      });

      // gửi ảnh chụp hiện tại của mọi topic cho thiết bị mới vào
      for (const topic of this.#topics.values()) {
        if (topic.text && !topic.dirty) {
          this.#write(response, this.#frame(topic.name, topic.text));
          continue;
        }
        if (topic.text) this.#write(response, this.#frame(topic.name, topic.text));
        if (!topic.building) await this.#rebuild(topic);
      }
      this.#write(response, `event: ready\ndata: {}\n\n`);
    };
  }

  close() {
    for (const client of this.#clients) {
      try {
        client.end();
      } catch {
        // đã đóng
      }
    }
    this.#clients.clear();
    this.#stopTimersIfIdle();
  }
}
