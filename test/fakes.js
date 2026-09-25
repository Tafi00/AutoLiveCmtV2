// Test doubles shared by the token transport tests.

export function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body };
    calls.push(call);
    const { status = 200, body = {} } = await handler(call);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { status, ok: status >= 200 && status < 300, text: async () => text };
  };
  return { fetchImpl, calls };
}

export class FakeWebSocket {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.receive('0{"sid":"engine","pingInterval":25000,"pingTimeout":20000}'));
  }

  receive(data) {
    this.onmessage?.({ data });
  }

  send(data) {
    this.sent.push(data);
    if (data.startsWith("40")) queueMicrotask(() => this.receive('40{"sid":"socket"}'));
    if (data.startsWith("42")) {
      const [event, payload] = JSON.parse(data.slice(2));
      this.onEmit?.(event, payload);
    }
  }

  close() {
    this.closed = true;
  }
}
