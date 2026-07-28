import assert from "node:assert/strict";
import test from "node:test";
import {
  TOKEN_SCALE,
  createGameplayInstructions,
  decodeMinerState,
  decodeProtocolState,
  estimatePendingRewards,
  formatTokenAmount,
  parseTokenAmount,
} from "../lib/uranium-client.ts";

function writeU64(data, offset, value) {
  new DataView(data.buffer).setBigUint64(offset, BigInt(value), true);
}

function writeI64(data, offset, value) {
  new DataView(data.buffer).setBigInt64(offset, BigInt(value), true);
}

test("parses and formats six-decimal USR amounts without floating point", () => {
  assert.equal(parseTokenAmount("1,000"), 1_000n * TOKEN_SCALE);
  assert.equal(parseTokenAmount("12.345678"), 12_345_678n);
  assert.equal(formatTokenAmount(12_345_678n, 6), "12.345678");
  assert.throws(() => parseTokenAmount("1.0000001"), /valid USR amount/);
});

test("decodes protocol and miner layouts and estimates unsettled rewards", () => {
  const protocolData = new Uint8Array(224);
  writeI64(protocolData, 112, 1_000);
  writeI64(protocolData, 120, 10_000);
  writeI64(protocolData, 128, 1_000);
  writeI64(protocolData, 136, 1_000);
  writeU64(protocolData, 144, 100);
  writeU64(protocolData, 152, 1_000);
  writeU64(protocolData, 160, 10);
  writeU64(protocolData, 168, 1_000_000);
  protocolData[216] = 200;
  protocolData[218] = 75;

  const minerData = new Uint8Array(122);
  writeU64(minerData, 40, 2);
  minerData[48] = 2;
  writeU64(minerData, 73, 7);

  const protocol = decodeProtocolState(protocolData);
  const miner = decodeMinerState(
    minerData,
    "11111111111111111111111111111111",
  );
  assert.equal(protocol.minBuildCost, 1_000n);
  assert.equal(protocol.claimFeeBps, 200);
  assert.equal(miner.rigLevels[0], 2);
  assert.equal(estimatePendingRewards(protocol, miner, 1_010n), 207n);
});

test("builds initialize, build, claim, and compound instruction plans", async () => {
  process.env.NEXT_PUBLIC_USR_PROGRAM_ID =
    "4ZssVwZYsfPAdoWozYyxPHFYts5uohJBHWCQo6yEm5AC";
  process.env.NEXT_PUBLIC_USR_MINT =
    "6cBq44LrxdqWyZrPyvkydQ32hGPhYvErtt66eyM4KVEg";
  process.env.NEXT_PUBLIC_USR_CONFIG_PDA =
    "24P7GQNwrNQnNojxipxAYR8nmBi3ZKWHoRB8zoetWX5A";
  process.env.NEXT_PUBLIC_USR_REWARD_VAULT =
    "1djxzK9KKKbfUpNSVDww3zFQqueEjCPLjrCkbU1V5X3";

  const ownerSigner = {
    address: "GHzzAsZq4oR6ZsqG1Mksgxyfm1X874KXGVRxNh65C2S5",
    signTransactions: async (transactions) =>
      transactions.map(() => new Uint8Array(64)),
  };
  const build = await createGameplayInstructions({
    action: "build",
    ownerSigner,
    slot: 3,
    amount: 1_000n * TOKEN_SCALE,
    initializeMiner: true,
  });
  assert.equal(build.instructions.length, 3);
  assert.deepEqual(
    Array.from(build.instructions[1].data),
    [170, 106, 254, 94, 49, 203, 51, 79],
  );
  assert.deepEqual(
    Array.from(build.instructions[2].data.slice(0, 9)),
    [242, 11, 116, 19, 182, 76, 114, 79, 3],
  );

  const claim = await createGameplayInstructions({
    action: "claim",
    ownerSigner,
    slot: 3,
  });
  const compound = await createGameplayInstructions({
    action: "compound",
    ownerSigner,
    slot: 3,
  });
  assert.equal(claim.instructions.length, 2);
  assert.equal(compound.instructions.length, 2);
  assert.equal(claim.instructions[1].accounts.length, 7);
  assert.equal(compound.instructions[1].accounts.length, 6);
});
