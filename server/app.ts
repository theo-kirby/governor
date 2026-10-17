import { governorGraph, toViewer } from "./governor";
import Fastify from "fastify";
import { z } from "zod";
import { FlywheelAdapter, resolveRepo, ViewerError } from "./adapter";

const querySchema = z.object({
  repo: z.string().trim().min(1).max(4096),
  tags: z.literal("1").optional(),
  head: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
});
export function createApp(adapter = new FlywheelAdapter()) {
  const app = Fastify({ logger: false });
  const port = process.env.PORT || "4311";
  // GOVERNOR_ALLOWED_HOSTS: extra Host values a local proxy forwards (e.g. a tailnet
  // name); each also becomes an allowed https:// origin.
  const extraHosts = (process.env.GOVERNOR_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const allowedHosts = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    "127.0.0.1:5173",
    "localhost:5173",
    ...extraHosts,
  ]);
  const allowedOrigins = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    ...extraHosts.map((h) => `https://${h}`),
  ];
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    if (!allowedHosts.has(request.headers.host || ""))
      return reply.code(403).send({ error: "Local access only." });
    if (
      request.headers.origin &&
      !allowedOrigins.includes(request.headers.origin)
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
    // GOVERNOR_DEFAULT_PARAMS: query applied when the URL names no repo, e.g.
    // "layout=hub"
    defaultParams: process.env.GOVERNOR_DEFAULT_PARAMS || "",
  }));
  app.get("/api/graph", async (request) => {
    const { repo, tags, head } = querySchema.parse(
      request.query,
    );
    const root = await resolveRepo(repo);
    // FLYWHEEL_REPO_LOCK=1: serve only FLYWHEEL_REPO, whatever ?repo= says (for a
    // viewer reachable beyond loopback).
    if (
      process.env.FLYWHEEL_REPO_LOCK === "1" &&
      root !== (await resolveRepo(process.env.FLYWHEEL_REPO || ""))
    )
      throw new ViewerError("This viewer serves one repository only.", 403);
    // a governor graph reads whole from its log (lib/snapshot.ts); any other Flywheel
    // repository goes through the generic adapter
    const governed = await governorGraph(root).catch(() => null);
    if (governed) return toViewer(root, governed);
    return adapter.snapshot(root, tags === "1", head);
  });
  return app;
}
