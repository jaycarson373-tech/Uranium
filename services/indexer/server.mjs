import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const required = [
  "SOLANA_RPC_HTTP_URL",
  "USR_PROGRAM_ID",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

const PORT = Number(process.env.PORT ?? 3001);
const RPC_URL = process.env.SOLANA_RPC_HTTP_URL;
const PROGRAM_ID = process.env.USR_PROGRAM_ID;
const SUPABASE_URL = process.env.SUPABASE_URL.replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INDEXER_NAME = process.env.INDEXER_NAME ?? "uranium-strategy-devnet";
const POLL_INTERVAL_MS = Math.max(1_000, Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 5_000));
const BOOTSTRAP_LIMIT = Math.min(100, Math.max(1, Number(process.env.INDEXER_BOOTSTRAP_LIMIT ?? 20)));
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

let polling = false;
let latestSignature = null;
let latestSlot = 0;
let lastError = null;
let lastPollAt = null;

function eventDiscriminator(name) {
  return createHash("sha256").update(`event:${name}`).digest().subarray(0, 8).toString("hex");
}

const EVENTS = new Map([
  [eventDiscriminator("ProtocolInitialized"), ["ProtocolInitialized", decodeProtocolInitialized]],
  [eventDiscriminator("ReserveFunded"), ["ReserveFunded", decodeReserveFunded]],
  [eventDiscriminator("MinerInitialized"), ["MinerInitialized", decodeMinerInitialized]],
  [eventDiscriminator("RigBuilt"), ["RigBuilt", decodeRigBuilt]],
  [eventDiscriminator("RewardsClaimed"), ["RewardsClaimed", decodeRewardsClaimed]],
  [eventDiscriminator("RewardsCompounded"), ["RewardsCompounded", decodeRewardsCompounded]],
  [eventDiscriminator("PauseChanged"), ["PauseChanged", decodePauseChanged]],
]);

function bytesToBase58(bytes) {
  if (bytes.length === 0) return "";
  const allZero = bytes.every((byte) => byte === 0);
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      const value = digits[i] * 256 + carry;
      digits[i] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    result += "1";
  }
  if (allZero) return result;
  for (let i = digits.length - 1; i >= 0; i -= 1) result += BASE58_ALPHABET[digits[i]];
  return result;
}

class Reader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  take(length) {
    if (length < 0 || this.offset + length > this.buffer.length) throw new Error("event payload truncated");
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  pubkey() { return bytesToBase58(this.take(32)); }
  u8() { return this.take(1)[0]; }
  bool() {
    const value = this.u8();
    if (value !== 0 && value !== 1) throw new Error("invalid boolean");
    return value === 1;
  }
  u64() { return this.take(8).readBigUInt64LE().toString(); }
  i64() { return this.take(8).readBigInt64LE().toString(); }
}

function decodeProtocolInitialized(reader) {
  return {
    authority: reader.pubkey(),
    mint: reader.pubkey(),
    fixed_supply: reader.u64(),
    season_end_ts: reader.i64(),
  };
}
function decodeReserveFunded(reader) {
  return { amount: reader.u64(), reserve_funded: reader.u64() };
}
function decodeMinerInitialized(reader) {
  return { owner: reader.pubkey() };
}
function decodeRigBuilt(reader) {
  return {
    owner: reader.pubkey(),
    slot: reader.u8(),
    level: reader.u8(),
    burn_amount: reader.u64(),
    total_power: reader.u64(),
  };
}
function decodeRewardsClaimed(reader) {
  return { owner: reader.pubkey(), gross: reader.u64(), fee: reader.u64(), net: reader.u64() };
}
function decodeRewardsCompounded(reader) {
  return {
    owner: reader.pubkey(),
    slot: reader.u8(),
    gross_consumed: reader.u64(),
    power_added: reader.u64(),
    remaining_rewards: reader.u64(),
  };
}
function decodePauseChanged(reader) {
  return { paused: reader.bool() };
}

function decodeEvent(base64) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 4_096) return null;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length < 8 || buffer.length > 2_048) return null;
  const descriptor = EVENTS.get(buffer.subarray(0, 8).toString("hex"));
  if (!descriptor) return null;
  const [eventType, decoder] = descriptor;
  const payload = decoder(new Reader(buffer.subarray(8)));
  const wallet = payload.owner ?? null;
  const cell = Number.isInteger(payload.slot) ? payload.slot : null;
  return { eventType, payload, wallet, cell, rawData: base64 };
}

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`RPC ${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
  return body.result;
}

async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Supabase ${response.status}: ${detail}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function loadCursor() {
  const rows = await supabase(`/rest/v1/indexer_state?name=eq.${encodeURIComponent(INDEXER_NAME)}&select=latest_signature,latest_slot&limit=1`);
  if (rows?.[0]) {
    latestSignature = rows[0].latest_signature;
    latestSlot = Number(rows[0].latest_slot ?? 0);
  }
}

async function saveCursor(signature, slot) {
  await supabase("/rest/v1/rpc/set_indexer_cursor", {
    method: "POST",
    body: JSON.stringify({
      p_name: INDEXER_NAME,
      p_latest_signature: signature,
      p_latest_slot: slot,
    }),
  });
  latestSignature = signature;
  latestSlot = Math.max(latestSlot, slot);
}

function extractProgramEvents(logs) {
  const events = [];
  const stack = [];
  for (let index = 0; index < logs.length; index += 1) {
    const line = typeof logs[index] === "string" ? logs[index] : "";
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    const finish = /^Program ([1-9A-HJ-NP-Za-km-z]+) (success|failed:)/.exec(line);
    if (finish) {
      if (stack.at(-1) === finish[1]) stack.pop();
      continue;
    }
    if (stack.at(-1) !== PROGRAM_ID || !line.startsWith("Program data: ")) continue;
    try {
      const event = decodeEvent(line.slice("Program data: ".length).trim());
      if (event) events.push({ ...event, logIndex: index });
    } catch {
      // Unknown or malformed chain data is ignored rather than trusted.
    }
  }
  return events;
}

async function ingestSignature(item) {
  const transaction = await rpc("getTransaction", [item.signature, {
    commitment: "confirmed",
    encoding: "json",
    maxSupportedTransactionVersion: 0,
  }]);
  if (!transaction?.meta || transaction.meta.err) return;
  const logs = Array.isArray(transaction.meta.logMessages) ? transaction.meta.logMessages : [];
  const events = extractProgramEvents(logs);
  const blockTime = transaction.blockTime
    ? new Date(transaction.blockTime * 1_000).toISOString()
    : null;

  for (const event of events) {
    await supabase("/rest/v1/rpc/ingest_protocol_event", {
      method: "POST",
      body: JSON.stringify({
        p_signature: item.signature,
        p_log_index: event.logIndex,
        p_chain_slot: Number(transaction.slot ?? item.slot),
        p_block_time: blockTime,
        p_event_type: event.eventType,
        p_wallet: event.wallet,
        p_cell: event.cell,
        p_payload: event.payload,
        p_raw_data: event.rawData,
      }),
    });
  }
}

async function getUnseenSignatures() {
  if (!latestSignature) {
    return rpc("getSignaturesForAddress", [PROGRAM_ID, {
      commitment: "confirmed",
      limit: BOOTSTRAP_LIMIT,
    }]);
  }

  const unseen = [];
  let before;
  for (let page = 0; page < 100; page += 1) {
    const options = {
      commitment: "confirmed",
      limit: 100,
      until: latestSignature,
      ...(before ? { before } : {}),
    };
    const batch = await rpc("getSignaturesForAddress", [PROGRAM_ID, options]);
    unseen.push(...batch);
    if (batch.length < options.limit) break;
    if (page === 99) throw new Error("Indexer backlog exceeds 10,000 signatures; cursor not advanced");
    before = batch.at(-1)?.signature;
    if (!before) break;
  }
  return unseen;
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const signatures = await getUnseenSignatures();
    const processable = signatures.filter(
      (item) => !item.err && typeof item.signature === "string",
    );
    for (const item of processable.reverse()) await ingestSignature(item);
    if (signatures[0]) await saveCursor(signatures[0].signature, Number(signatures[0].slot));
    lastPollAt = new Date().toISOString();
    lastError = null;
  } catch (error) {
    lastError = error instanceof Error ? error.message : "unknown indexer error";
  } finally {
    polling = false;
  }
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": ALLOWED_ORIGIN,
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function runSelfTest() {
  assert.equal(bytesToBase58(Buffer.alloc(32)), "1".repeat(32));

  const owner = Buffer.alloc(32, 7);
  const data = Buffer.alloc(8 + 32 + 1 + 1 + 8 + 8);
  Buffer.from(eventDiscriminator("RigBuilt"), "hex").copy(data, 0);
  owner.copy(data, 8);
  data.writeUInt8(3, 40);
  data.writeUInt8(4, 41);
  data.writeBigUInt64LE(1_000_000_000n, 42);
  data.writeBigUInt64LE(4n, 50);

  const encoded = data.toString("base64");
  const decoded = decodeEvent(encoded);
  assert.equal(decoded?.eventType, "RigBuilt");
  assert.equal(decoded?.cell, 3);
  assert.equal(decoded?.payload.level, 4);
  assert.equal(decoded?.payload.burn_amount, "1000000000");

  const extracted = extractProgramEvents([
    `Program ${PROGRAM_ID} invoke [1]`,
    `Program data: ${encoded}`,
    `Program ${PROGRAM_ID} success`,
  ]);
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].wallet, bytesToBase58(owner));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      const slot = await rpc("getSlot", [{ commitment: "confirmed" }]);
      return writeJson(response, lastError ? 503 : 200, {
        ok: !lastError,
        cluster: process.env.SOLANA_CLUSTER ?? "devnet",
        program: PROGRAM_ID,
        rpcSlot: slot,
        indexedSlot: latestSlot,
        lastPollAt,
        error: lastError,
      });
    }
    if (url.pathname === "/leaderboard") {
      const rows = await supabase("/rest/v1/leaderboard?select=*&order=rank.asc&limit=100");
      return writeJson(response, 200, rows);
    }
    if (url.pathname === "/protocol") {
      const rows = await supabase("/rest/v1/protocol_state?id=eq.canonical&select=*&limit=1");
      return writeJson(response, 200, rows?.[0] ?? null);
    }
    return writeJson(response, 404, { error: "not found" });
  } catch (error) {
    return writeJson(response, 500, {
      error: error instanceof Error ? error.message : "internal error",
    });
  }
});

if (process.env.INDEXER_SELF_TEST === "1") {
  runSelfTest();
} else {
  await loadCursor();
  await poll();
  setInterval(poll, POLL_INTERVAL_MS).unref();
  server.listen(PORT, "0.0.0.0");
}
