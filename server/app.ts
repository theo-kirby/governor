import { access } from "node:fs/promises";
import { join } from "node:path";
import { hypergraphSnapshot } from "./hypergraph";
import Fastify from "fastify";
import { z } from "zod";
import { FlywheelAdapter, resolveRepo, ViewerError } from "./adapter";

const querySchema = z.object({
  repo: z.string().trim().min(1).max(4096),
  tags: z.literal("1").optional(),
  view: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  citations: z.enum(["0", "1"]).optional(),
  source: z.enum(["flywheel", "hypergraph"]).optional(),
  head: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
});
export function createApp(adapter = new FlywheelAdapter()) {
  const app = Fastify({ logger: false });
  const allowedHosts = new Set([
    "127.0.0.1:4311",
    "localhost:4311",
    "127.0.0.1:5173",
    "localhost:5173",
  ]);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    if (!allowedHosts.has(request.headers.host || ""))
      return reply.code(403).send({ error: "Local access only." });
    if (
      request.headers.origin &&
      ![
        "http://127.0.0.1:4311",
        "http://localhost:4311",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
      ].includes(request.headers.origin)
    ) {
      return reply
        .code(403)
        .send({ error: "Cross-origin access is disabled." });
    }
    if (
      request.url.startsWith("/api/") &&
      request.headers["x-flywheel-viewer"] !== "1"
    ) {
      return reply.code(403).send({ error: "Viewer request header required." });
    }
    if (process.env.NODE_ENV === "production") {
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      );
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: "Invalid request or unsupported Flywheel response format.",
      });
    if (error instanceof ViewerError)
      return reply.code(error.statusCode).send({ error: error.message });
    reply.code(500).send({ error: "The viewer could not complete this read." });
  });
  app.get("/api/config", async () => ({
    defaultRepo: process.env.FLYWHEEL_REPO || "",
  }));
  app.get("/api/graph", async (request) => {
    const { repo, tags, head, view, citations, source } = querySchema.parse(
      request.query,
    );
    const root = await resolveRepo(repo);
    let flywheel = source !== "hypergraph";
    if (flywheel && source !== "flywheel")
      try {
        await access(join(root, ".flywheel/db.sqlite"));
      } catch {
        flywheel = false;
      }
    if (!flywheel)
      return hypergraphSnapshot(root, { view, citations: citations !== "0" });
    return adapter.snapshot(root, tags === "1", head);
  });
  return app;
}
