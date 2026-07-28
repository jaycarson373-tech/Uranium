import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

const RPC_URL = process.env.SURFPOOL_RPC_URL ?? "http://127.0.0.1:8899";
const PROGRAM_ID = address("4ZssVwZYsfPAdoWozYyxPHFYts5uohJBHWCQo6yEm5AC");
const AUTHORITY = address("GHzzAsZq4oR6ZsqG1Mksgxyfm1X874KXGVRxNh65C2S5");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const MIN_BUILD_COST = 1_000_000_000n;
const CONCURRENT_SUBMISSIONS = 100;
const addressEncoder = getAddressEncoder();

const DISCRIMINATORS = {
  initializeMiner: Uint8Array.from([170, 106, 254, 94, 49, 203, 51, 79]),
  buildRig: Uint8Array.from([242, 11, 116, 19, 182, 76, 114, 79]),
  claimRewards: Uint8Array.from([4, 144, 132, 71, 116, 23, 151, 80]),
  compoundRewards: Uint8Array.from([254, 191, 226, 120, 82, 115, 5, 87]),
  setPaused: Uint8Array.from([91, 60, 125, 192, 176, 225, 166, 218]),
};

function concatBytes(...chunks) {
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function encodeU64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) {
    const error = new Error(body.error.message);
    error.data = body.error.data;
    throw error;
  }
  return body.result;
}

async function deriveAta(owner, mint) {
  return getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [
      addressEncoder.encode(owner),
      addressEncoder.encode(TOKEN_PROGRAM),
      addressEncoder.encode(mint),
    ],
  });
}

const [config] = await getProgramDerivedAddress({
  programAddress: PROGRAM_ID,
  seeds: ["config", addressEncoder.encode(AUTHORITY)],
});
const [mint] = await getProgramDerivedAddress({
  programAddress: PROGRAM_ID,
  seeds: ["usr-mint", addressEncoder.encode(AUTHORITY)],
});
const [authorityTokens] = await deriveAta(AUTHORITY, mint);
const [rewardVault] = await deriveAta(config, mint);
const [miner] = await getProgramDerivedAddress({
  programAddress: PROGRAM_ID,
  seeds: ["miner", addressEncoder.encode(config), addressEncoder.encode(AUTHORITY)],
});

function initializeMinerInstruction() {
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: AUTHORITY, role: AccountRole.WRITABLE_SIGNER },
      { address: config, role: AccountRole.READONLY },
      { address: miner, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: DISCRIMINATORS.initializeMiner,
  };
}

function buildRigInstruction(slot, amount = MIN_BUILD_COST) {
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: AUTHORITY, role: AccountRole.READONLY_SIGNER },
      { address: config, role: AccountRole.WRITABLE },
      { address: miner, role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.WRITABLE },
      { address: authorityTokens, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    ],
    data: concatBytes(DISCRIMINATORS.buildRig, Uint8Array.of(slot), encodeU64(amount)),
  };
}

function claimRewardsInstruction() {
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: AUTHORITY, role: AccountRole.READONLY_SIGNER },
      { address: config, role: AccountRole.WRITABLE },
      { address: miner, role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.WRITABLE },
      { address: rewardVault, role: AccountRole.WRITABLE },
      { address: authorityTokens, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    ],
    data: DISCRIMINATORS.claimRewards,
  };
}

function compoundRewardsInstruction(slot) {
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: AUTHORITY, role: AccountRole.READONLY_SIGNER },
      { address: config, role: AccountRole.WRITABLE },
      { address: miner, role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.WRITABLE },
      { address: rewardVault, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    ],
    data: concatBytes(DISCRIMINATORS.compoundRewards, Uint8Array.of(slot)),
  };
}

function setPausedInstruction(paused) {
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: AUTHORITY, role: AccountRole.READONLY_SIGNER },
      { address: config, role: AccountRole.WRITABLE },
    ],
    data: concatBytes(DISCRIMINATORS.setPaused, Uint8Array.of(paused ? 1 : 0)),
  };
}

async function encodedTransaction(instructions) {
  const { value: latestBlockhash } = await rpc("getLatestBlockhash", [
    { commitment: "confirmed" },
  ]);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(AUTHORITY, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, value),
    (value) => appendTransactionMessageInstructions(instructions, value),
  );
  const transaction = compileTransaction(message);
  const signedForLocalFork = {
    ...transaction,
    signatures: {
      ...transaction.signatures,
      [AUTHORITY]: randomBytes(64),
    },
  };
  return getBase64EncodedWireTransaction(signedForLocalFork);
}

async function sendInstructions(instructions) {
  const wire = await encodedTransaction(instructions);
  return rpc("sendTransaction", [
    wire,
    {
      encoding: "base64",
      preflightCommitment: "confirmed",
      skipPreflight: false,
    },
  ]);
}

async function accountBytes(accountAddress) {
  const { value } = await rpc("getAccountInfo", [
    accountAddress,
    { commitment: "confirmed", encoding: "base64" },
  ]);
  if (!value) throw new Error(`Missing account ${accountAddress}`);
  return Buffer.from(value.data[0], "base64");
}

async function tokenBalance(tokenAddress) {
  const { value } = await rpc("getTokenAccountBalance", [
    tokenAddress,
    { commitment: "confirmed" },
  ]);
  return BigInt(value.amount);
}

const beforeAuthorityBalance = await tokenBalance(authorityTokens);
await sendInstructions([initializeMinerInstruction(), buildRigInstruction(0)]);

const afterBuildMiner = await accountBytes(miner);
assert.equal(afterBuildMiner.readBigUInt64LE(40), 1n);
assert.equal(afterBuildMiner.readUInt8(48), 1);

await sleep(3_000);
await sendInstructions([claimRewardsInstruction()]);
const afterClaimMiner = await accountBytes(miner);
const claimed = afterClaimMiner.readBigUInt64LE(105);
assert.ok(claimed > 0n, "claim should settle a positive reward");
assert.ok(await tokenBalance(authorityTokens) > beforeAuthorityBalance - MIN_BUILD_COST);

await sleep(22_000);
await sendInstructions([compoundRewardsInstruction(1)]);
const afterCompoundMiner = await accountBytes(miner);
assert.equal(afterCompoundMiner.readBigUInt64LE(40), 2n);
assert.equal(afterCompoundMiner.readUInt8(49), 1);
assert.ok(afterCompoundMiner.readBigUInt64LE(113) >= MIN_BUILD_COST);

let rejectedInvalidBuild = false;
try {
  await sendInstructions([buildRigInstruction(2, MIN_BUILD_COST - 1n)]);
} catch (error) {
  rejectedInvalidBuild = /custom program error|simulation failed/i.test(error.message);
}
assert.equal(rejectedInvalidBuild, true, "invalid build amount must fail");

let rejectedSubstitutedAccount = false;
try {
  const substituted = buildRigInstruction(2);
  substituted.accounts[4] = { address: rewardVault, role: AccountRole.WRITABLE };
  await sendInstructions([substituted]);
} catch (error) {
  rejectedSubstitutedAccount = /custom program error|simulation failed/i.test(error.message);
}
assert.equal(rejectedSubstitutedAccount, true, "substituted token account must fail");

await sendInstructions([setPausedInstruction(true)]);
const pausedConfig = await accountBytes(config);
assert.equal(pausedConfig.readUInt8(222), 1);
let rejectedPausedBuild = false;
try {
  await sendInstructions([buildRigInstruction(2)]);
} catch (error) {
  rejectedPausedBuild = /custom program error|simulation failed/i.test(error.message);
}
assert.equal(rejectedPausedBuild, true, "build must fail while paused");
await sendInstructions([claimRewardsInstruction()]);
await sendInstructions([setPausedInstruction(false)]);

const concurrencyStartedAt = Date.now();
const concurrentSignatures = await Promise.all(
  Array.from({ length: CONCURRENT_SUBMISSIONS }, (_, index) =>
    sendInstructions([buildRigInstruction(2 + (index % 10))]),
  ),
);
const concurrencyDurationMs = Date.now() - concurrencyStartedAt;
assert.equal(new Set(concurrentSignatures).size, CONCURRENT_SUBMISSIONS);

const finalMiner = await accountBytes(miner);
const finalConfig = await accountBytes(config);
const expectedFinalPower = 2n + BigInt(CONCURRENT_SUBMISSIONS);
assert.equal(finalMiner.readBigUInt64LE(40), expectedFinalPower);
assert.equal(finalConfig.readBigUInt64LE(160), expectedFinalPower);
for (let slot = 2; slot < 12; slot += 1) {
  assert.equal(finalMiner.readUInt8(48 + slot), CONCURRENT_SUBMISSIONS / 10);
}

console.log(JSON.stringify({
  passed: true,
  network: "Surfpool Devnet fork",
  liveDevnetMutated: false,
  signatures: {
    concurrent: concurrentSignatures.length,
  },
  lifecycle: {
    build: true,
    claim: true,
    compound: true,
    invalidBuildRejected: rejectedInvalidBuild,
    substitutedAccountRejected: rejectedSubstitutedAccount,
    pausedBuildRejected: rejectedPausedBuild,
    claimWhilePaused: true,
  },
  finalState: {
    power: finalMiner.readBigUInt64LE(40).toString(),
    claimedRaw: claimed.toString(),
    compoundedRaw: finalMiner.readBigUInt64LE(113).toString(),
    totalPower: finalConfig.readBigUInt64LE(160).toString(),
  },
  concurrency: {
    submissions: concurrentSignatures.length,
    durationMs: concurrencyDurationMs,
  },
}, null, 2));
