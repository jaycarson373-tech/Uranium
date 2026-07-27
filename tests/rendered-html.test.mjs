import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Uranium Strategy beta app", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Uranium Strategy/);
  assert.match(html, /Solana · Beta/);
  assert.match(html, /Open Protocol Console/);
  assert.match(html, /Program unavailable/);
});

test("keeps transactions gated while supporting a cluster cutover", async () => {
  const [page, providers, protocol] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/providers.tsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/PROTOCOL.md", import.meta.url), "utf8"),
  ]);

  assert.match(providers, /"solana:mainnet"/);
  assert.match(providers, /"solana:devnet"/);
  assert.match(providers, /https:\/\/api\.devnet\.solana\.com/);
  assert.match(page, /NEXT_PUBLIC_USR_PROGRAM_ID/);
  assert.match(page, /NEXT_PUBLIC_USR_MINT/);
  assert.match(page, /On-chain actions activate at launch/);
  assert.match(page, /type="button" disabled>On-chain actions activate at launch/);
  assert.doesNotMatch(page, /Devnet|devnet|pre-launch/);
  assert.doesNotMatch(page, /Robinhood Chain/);
  assert.match(protocol, /No deployment or token transaction should occur/);
});

test("keeps wallet startup isolated from the landing page", async () => {
  const [layout, page, island, runtime] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/wallet-island.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/wallet-runtime.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(layout, /<Providers>/);
  assert.doesNotMatch(page, /@solana\/kit-plugin-wallet/);
  assert.match(page, /<WalletIsland variant="compact"/);
  assert.match(island, /lazy\(\(\) => import\("\.\/wallet-runtime"\)\)/);
  assert.match(island, /WalletErrorBoundary/);
  assert.match(island, /if \(!mounted\)/);
  assert.match(runtime, /<Providers>/);
  assert.match(runtime, /WalletReadyGate/);
});
