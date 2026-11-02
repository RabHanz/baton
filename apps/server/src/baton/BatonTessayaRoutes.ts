// @effect-diagnostics nodeBuiltinImport:off
/**
 * The phone page at /tessaya (docs/baton/MOBILE.md): the page itself, then a small API behind the server's own session
 * (the pairing cookie, or a bearer token), with the rules in BatonTessayaApi. Mounted by BatonServerLayer.routes.
 */
import * as NodePath from "node:path";

import { buildPhoneState } from "@t3tools/baton-shared/phone";
import { watchFleet } from "@t3tools/baton-shared/watch";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as JobFlow from "./BatonJobFlow.ts";
import { BatonWeaveService } from "./BatonWeaveService.ts";
import { BatonRuntime } from "./BatonRpcHandlers.ts";
import * as FleetQuery from "./FleetQuery.ts";
import { BatonPhoneInbox } from "./BatonPhoneInbox.ts";
import { handlePhone, type PhoneDeps } from "./BatonTessayaApi.ts";
import { transcribeWav } from "./BatonPhoneVoice.ts";
import { HTML, MANIFEST, SCRIPT, SERVICE_WORKER } from "./BatonTessayaPage.ts";

const PAGE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src blob:; manifest-src 'self'; frame-ancestors 'none'",
} as const;

const page = (body: string, contentType: string) =>
  HttpServerResponse.text(body, { contentType, headers: PAGE_HEADERS });

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const context = yield* BatonRuntime;
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const config = yield* ServerConfig.ServerConfig;

    if (context === null) return;
    const run = Effect.runPromiseWith(context);
    const deps: PhoneDeps = {
      state: () =>
        run(
          Effect.gen(function* () {
            const inbox = yield* BatonPhoneInbox;
            const now = yield* Clock.currentTimeMillis;
            const fleet = yield* FleetQuery.getFleet({});
            return buildPhoneState({
              jobs: yield* JobFlow.listJobs(),
              findings: watchFleet(fleet.entries, now),
              weaves: (yield* (yield* BatonWeaveService).list(30)) as never,
              now,
              prompts: yield* inbox.pending,
              asks: yield* inbox.recent(8),
              desktopConnected: yield* inbox.connected,
            });
          }),
        ),
      agree: (id) => run(Effect.asVoid(JobFlow.agreeJob(id as never))),
      stop: (id) => run(JobFlow.stopJob(id as never)),
      retry: (id) => run(JobFlow.retryJob(id as never)),
      ask: (id, text) => run(Effect.flatMap(BatonPhoneInbox, (inbox) => inbox.post({ id, text }))),
      askGet: (id) =>
        run(
          Effect.flatMap(BatonPhoneInbox, (inbox) =>
            Effect.all({ ask: inbox.get(id), connected: inbox.connected }),
          ),
        ),
      answerPrompt: (id, index) => run(Effect.flatMap(BatonPhoneInbox, (inbox) => inbox.answerPrompt(id, index))),
      transcribe: (wav) =>
        transcribeWav({ wav, env: process.env, userdataDir: NodePath.dirname(config.dbPath) }),
    };

    const api = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const session = yield* auth.authenticateHttpRequest(request).pipe(Effect.option);
      if (session._tag === "None") {
        return HttpServerResponse.jsonUnsafe({ message: "Not paired." }, { status: 401, headers: PAGE_HEADERS });
      }
      const url = new URL(request.url, "http://local");
      const path = url.pathname.replace(/^\/tessaya\/api\//, "");
      const type = request.headers["content-type"] ?? "";
      const raw = request.method === "POST" && type.startsWith("audio/");
      const bytes = raw ? new Uint8Array(yield* request.arrayBuffer) : undefined;
      const json = request.method === "POST" && !raw ? yield* request.json.pipe(Effect.orElseSucceed(() => ({}))) : undefined;
      const answer = yield* Effect.promise(() =>
        handlePhone(deps, {
          method: request.method,
          path,
          scopes: new Set(session.value.scopes),
          ...(json === undefined ? {} : { json }),
          ...(bytes === undefined ? {} : { bytes }),
          ...(request.headers["x-client-id"] === undefined ? {} : { clientId: request.headers["x-client-id"] }),
        }),
      );
      return HttpServerResponse.jsonUnsafe(answer.json, { status: answer.status, headers: PAGE_HEADERS });
    }).pipe(
      Effect.catchCause(() =>
        Effect.succeed(HttpServerResponse.jsonUnsafe({ message: "That did not work." }, { status: 500 })),
      ),
    );

    yield* router.add("GET", "/tessaya", Effect.sync(() => page(HTML, "text/html; charset=utf-8")));
    yield* router.add("GET", "/tessaya/", Effect.sync(() => page(HTML, "text/html; charset=utf-8")));
    yield* router.add("GET", "/tessaya/app.js", Effect.sync(() => page(SCRIPT, "text/javascript; charset=utf-8")));
    yield* router.add("GET", "/tessaya/sw.js", Effect.sync(() => page(SERVICE_WORKER, "text/javascript; charset=utf-8")));
    yield* router.add(
      "GET",
      "/tessaya/manifest.webmanifest",
      Effect.sync(() => page(MANIFEST, "application/manifest+json")),
    );
    yield* router.add("GET", "/tessaya/api/*", api);
    yield* router.add("POST", "/tessaya/api/*", api);
  }),
);
