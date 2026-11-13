import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";

// A small fetch-based stand-in for supertest, covering what the API suites use:
// `request(urlOrApp).get|post|put|patch|delete(path)`, optionally `.set(header)`,
// `.send(body)` and `.responseType("blob")`, then `await` for
// `{ status, headers, type, body, text }`. As with supertest, a 4xx/5xx is a
// response, not an error.

// A base URL (a running service) or a request handler such as an Express app,
// which is served on an ephemeral port for the one request.
type Target = string | RequestListener;

export type TestResponse = {
  status: number;
  // Lower-cased header names.
  headers: Record<string, string>;
  // The Content-Type without its parameters, e.g. "application/json".
  type: string;
  // Parsed JSON for a JSON response, a Buffer for a binary one (or for any
  // response after `.responseType("blob")`), and `{}` for text or no body
  // (read `text`), as supertest does.
  // biome-ignore lint/suspicious/noExplicitAny: tests assert on arbitrary shapes.
  body: any;
  text: string;
};

class TestRequest implements PromiseLike<TestResponse> {
  readonly #target: Target;
  readonly #method: string;
  readonly #path: string;
  readonly #headers = new Headers();
  #body: string | Uint8Array<ArrayBuffer> | undefined;
  #asBuffer = false;

  constructor(target: Target, method: string, path: string) {
    this.#target = target;
    this.#method = method;
    this.#path = path;
  }

  set(name: string, value: string) {
    this.#headers.set(name, value);
    return this;
  }

  // An object goes as JSON; a string goes as is (set its Content-Type first,
  // otherwise it goes as a form, as with supertest); bytes go as is, as
  // `application/octet-stream` unless set. With no body, as in
  // `.get(path).send()`, the request goes without one.
  send(body?: unknown) {
    if (body === undefined) return this;
    if (body instanceof Uint8Array) {
      this.#body = new Uint8Array(body);
      if (!this.#headers.has("content-type")) {
        this.#headers.set("content-type", "application/octet-stream");
      }
      return this;
    }
    const isString = typeof body === "string";
    this.#body = isString ? body : JSON.stringify(body);
    if (!this.#headers.has("content-type")) {
      this.#headers.set(
        "content-type",
        isString ? "application/x-www-form-urlencoded" : "application/json",
      );
    }
    return this;
  }

  // Read the body as a Buffer whatever its Content-Type.
  responseType(type: "blob") {
    this.#asBuffer = type === "blob";
    return this;
  }

  // biome-ignore lint/suspicious/noThenProperty: awaiting the builder sends it, as with supertest.
  then<T = TestResponse, E = never>(
    onfulfilled?: ((value: TestResponse) => T | PromiseLike<T>) | null,
    onrejected?: ((reason: unknown) => E | PromiseLike<E>) | null,
  ): Promise<T | E> {
    return this.#run().then(onfulfilled, onrejected);
  }

  async #run() {
    if (typeof this.#target === "string") return this.#fetch(this.#target);

    const server = createServer(this.#target);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const { port } = server.address() as AddressInfo;
      return await this.#fetch(`http://127.0.0.1:${port}`);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }

  async #fetch(baseUrl: string): Promise<TestResponse> {
    const res = await fetch(`${baseUrl}${this.#path}`, {
      method: this.#method,
      headers: this.#headers,
      body: this.#body,
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString("utf8");
    const type = res.headers.get("content-type") ?? "";
    let body: unknown = {};
    if (this.#asBuffer) {
      body = bytes;
    } else if (/[/+]json\b/.test(type)) {
      body = text ? JSON.parse(text) : {};
    } else if (bytes.length > 0 && !type.startsWith("text/")) {
      body = bytes;
    }
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers),
      type: type.split(";")[0]?.trim() ?? "",
      body,
      text,
    };
  }
}

export const request = (target: Target) => ({
  get: (path: string) => new TestRequest(target, "GET", path),
  post: (path: string) => new TestRequest(target, "POST", path),
  put: (path: string) => new TestRequest(target, "PUT", path),
  patch: (path: string) => new TestRequest(target, "PATCH", path),
  delete: (path: string) => new TestRequest(target, "DELETE", path),
});
