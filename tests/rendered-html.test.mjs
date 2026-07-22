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

test("server-renders the Uranium Strategy devnet app", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Uranium Strategy/);
  assert.match(html, /Solana · Devnet/);
  assert.match(html, /Open Devnet Console/);
  assert.match(html, /Devnet deploy pending/);
});

test("keeps transactions gated until real addresses exist", async () => {
  const [page, providers, protocol] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/providers.tsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/PROTOCOL.md", import.meta.url), "utf8"),
  ]);

  assert.match(providers, /chain: "solana:devnet"/);
  assert.match(providers, /https:\/\/api\.devnet\.solana\.com/);
  assert.match(page, /NEXT_PUBLIC_USR_PROGRAM_ID/);
  assert.match(page, /NEXT_PUBLIC_USR_MINT/);
  assert.match(page, /Deploy after devnet approval/);
  assert.match(page, /type="button" disabled>Deploy after devnet approval/);
  assert.doesNotMatch(page, /Robinhood Chain/);
  assert.match(protocol, /No deployment or token transaction should occur/);
});
