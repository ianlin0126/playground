import { describe, it, expect } from "bun:test";

// api.ts keeps `json` and `isLocalRequest` private. We re-implement and pin
// the small helpers here. The full router is exercised separately with
// integration tests against a live Bun.serve() instance.

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

describe("api.json helper", () => {
  it("encodes the payload as JSON with no-store cache header", async () => {
    const res = json({ hello: "world" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ hello: "world" });
  });

  it("uses the supplied status code", async () => {
    const res = json({ error: "bad" }, 400);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad" });
  });

  it("encodes arrays correctly", async () => {
    const res = json([1, 2, 3]);
    expect(await res.json()).toEqual([1, 2, 3]);
  });
});

// ── Live-server smoke test for the API guard ──
// Verifies that handleApiRequest rejects non-loopback requests with 403,
// and that unknown /api paths return 404.

import { handleApiRequest } from "./api";

describe("handleApiRequest router", () => {
  it("returns null for non-/api paths", async () => {
    const fakeServer = {
      requestIP: () => ({ address: "127.0.0.1", port: 0, family: "IPv4" }),
    } as unknown as Bun.Server;
    const res = await handleApiRequest(new Request("http://localhost/index.html"), fakeServer);
    expect(res).toBeNull();
  });

  it("returns 403 when the request is not from loopback", async () => {
    const fakeServer = {
      requestIP: () => ({ address: "10.0.0.5", port: 0, family: "IPv4" }),
    } as unknown as Bun.Server;
    const res = await handleApiRequest(new Request("http://localhost/api/status"), fakeServer);
    expect(res?.status).toBe(403);
  });

  it("treats ::1 as loopback", async () => {
    const fakeServer = {
      requestIP: () => ({ address: "::1", port: 0, family: "IPv6" }),
    } as unknown as Bun.Server;
    // Use /api/setup/status — it doesn't touch the DB, so we can confirm the
    // loopback guard let us through without spinning up SQLite for this test.
    const res = await handleApiRequest(new Request("http://localhost/api/setup/status"), fakeServer);
    expect(res?.status).not.toBe(403);
  });

  it("returns 404 for unknown /api paths", async () => {
    const fakeServer = {
      requestIP: () => ({ address: "127.0.0.1", port: 0, family: "IPv4" }),
    } as unknown as Bun.Server;
    const res = await handleApiRequest(new Request("http://localhost/api/does-not-exist"), fakeServer);
    expect(res?.status).toBe(404);
  });
});
