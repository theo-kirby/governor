import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import { createApp } from "./app";
const app = createApp();
if (process.env.NODE_ENV === "production") {
  await app.register(fastifyStatic, {
    root: resolve("dist"),
    index: "index.html",
  });
}
try {
  const port = Number(process.env.PORT || 4311);
  await app.listen({ host: "127.0.0.1", port });
  console.log(
    `Flywheel viewer ${process.env.NODE_ENV === "production" ? `→ http://127.0.0.1:${port}` : `API → http://127.0.0.1:${port} (open Vite on :5173)`}`,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Could not start viewer.",
  );
  process.exit(1);
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
