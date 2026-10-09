import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { FlywheelAdapter } from "../server/adapter";
const headers = { host: "127.0.0.1:4311", "x-flywheel-viewer": "1" };
test("API rejects foreign origins, host spoofing, and simple cross-origin reads", async () => {
  const app = createApp();
  try {
    for (const invalid of [
      { host: "evil.example:4311", "x-flywheel-viewer": "1" },
      { ...headers, origin: "https://evil.example" },
      { host: "127.0.0.1:4311" },
    ]) {
      const response = await app.inject({
        url: "/api/config",
        headers: invalid,
      });
      assert.equal(response.statusCode, 403);
    }
    assert.equal(
      (await app.inject({ url: "/api/config", headers })).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ method: "POST", url: "/api/graph", headers }))
        .statusCode,
      404,
    );
  } finally {
    await app.close();
  }
});
test("validates repository paths before invoking CLI", async () => {
  let called = false;
  const app = createApp(
    new FlywheelAdapter(async () => {
      called = true;
      return {};
    }),
  );
  try {
    assert.equal(
      (await app.inject({ url: "/api/graph?repo=/does-not-exist", headers }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/graph",
          headers,
        })
      ).statusCode,
      400,
    );
    assert.equal(called, false);
  } finally {
    await app.close();
  }
});
test("accepts a .flywheel directory, exposes only committed normalized data, disables caching", async () => {
  const root = await mkdtemp(join(tmpdir(), "flywheel-viz-test-"));
  await mkdir(join(root, ".flywheel"));
  await writeFile(join(root, ".flywheel/db.sqlite"), "synthetic placeholder");
  const head = `sha256:${"a".repeat(64)}`;
  const app = createApp(
    new FlywheelAdapter(async (command) =>
      command === "repo:status"
        ? {
            repository_id: "synthetic",
            heads: { workspace: head },
            staging: { operation_count: 0 },
          }
        : { at_head: head, next_cursor: null, nodes: [] },
    ),
  );
  try {
    const response = await app.inject({
      url: `/api/graph?repo=${encodeURIComponent(join(root, ".flywheel"))}`,
      headers,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().repositoryId, "synthetic");
    assert.deepEqual(response.json().nodes, []);
    assert.equal(response.headers["cache-control"], "no-store");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
