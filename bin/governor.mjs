#!/usr/bin/env node
// Runs the TypeScript CLI through tsx, so the package ships its sources unbuilt.
import { register } from "tsx/esm/api";
register();
await import("../cli/main.ts");
