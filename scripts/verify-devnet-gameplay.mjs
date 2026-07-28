import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { getMintDecoder, getTokenDecoder } from "@solana-program/token";

const RPC_URL = process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = address("4ZssVwZYsfPAdoWozYyxPHFYts5uohJBHWCQo6yEm5AC");
const AUTHORITY = address("GHzzAsZq4oR6ZsqG1Mksgxyfm1X874KXGVRxNh65C2S5");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const INITIALIZE_MINER_DISCRIMINATOR = Uint8Array.from([
  170, 106, 254, 94, 49, 203, 51, 79,
]);
const BUILD_RIG_DISCRIMINATOR = Uint8Array.from([
  242, 11, 116, 19, 182, 76, 114, 79,
]);
const BUILD_SLOT = 0;
const BUILD_BURN_RAW = 1_000_000_000n;

const rpc = createSolanaRpc(RPC_URL);
const addressEncoder = getAddressEncoder();

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

function accountBytes(accountInfo) {
  if (!accountInfo || !Array.isArray(accountInfo.data) || accountInfo.data[1] !== "base64") {
    throw new Error("Simulation did not return base64 account data");
  }
  return Buffer.from(accountInfo.data[0], "base64");
}

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
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
const [miner, minerBump] = await getProgramDerivedAddress({
  programAddress: PROGRAM_ID,
  seeds: ["miner", addressEncoder.encode(config), addressEncoder.encode(AUTHORITY)],
});

const liveAccountsResponse = await rpc
  .getMultipleAccounts([config, mint, authorityTokens, miner], {
    commitment: "confirmed",
    encoding: "base64",
  })
  .send();
const [liveConfig, liveMint, liveAuthorityTokens, liveMiner] = liveAccountsResponse.value;
if (!liveConfig || !liveMint || !liveAuthorityTokens) {
  throw new Error("Bootstrapped Devnet accounts are missing");
}
if (liveMiner) {
  throw new Error("Gameplay smoke test requires the canonical miner PDA to be uninitialized");
}

const initializeMinerInstruction = {
  programAddress: PROGRAM_ID,
  accounts: [
    { address: AUTHORITY, role: AccountRole.WRITABLE_SIGNER },
    { address: config, role: AccountRole.READONLY },
    { address: miner, role: AccountRole.WRITABLE },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
  ],
  data: INITIALIZE_MINER_DISCRIMINATOR,
};
const buildRigInstruction = {
  programAddress: PROGRAM_ID,
  accounts: [
    { address: AUTHORITY, role: AccountRole.READONLY_SIGNER },
    { address: config, role: AccountRole.WRITABLE },
    { address: miner, role: AccountRole.WRITABLE },
    { address: mint, role: AccountRole.WRITABLE },
    { address: authorityTokens, role: AccountRole.WRITABLE },
    { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
  ],
  data: concatBytes(
    BUILD_RIG_DISCRIMINATOR,
    Uint8Array.of(BUILD_SLOT),
    encodeU64(BUILD_BURN_RAW),
  ),
};

const latestBlockhashResponse = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (message) => setTransactionMessageFeePayer(AUTHORITY, message),
  (message) =>
    setTransactionMessageLifetimeUsingBlockhash(latestBlockhashResponse.value, message),
  (message) =>
    appendTransactionMessageInstructions(
      [initializeMinerInstruction, buildRigInstruction],
      message,
    ),
);
const transaction = compileTransaction(transactionMessage);
const simulationResponse = await rpc
  .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
    commitment: "confirmed",
    encoding: "base64",
    sigVerify: false,
    innerInstructions: true,
    accounts: {
      addresses: [config, miner, mint, authorityTokens],
      encoding: "base64",
    },
  })
  .send();
const simulation = simulationResponse.value;
if (simulation.err) {
  console.log(JSON.stringify(simulation, jsonReplacer, 2));
  process.exit(1);
}

const [simulatedConfigAccount, simulatedMinerAccount, simulatedMintAccount, simulatedTokensAccount] =
  simulation.accounts;
const configBytes = accountBytes(simulatedConfigAccount);
const minerBytes = accountBytes(simulatedMinerAccount);
const mintState = getMintDecoder().decode(accountBytes(simulatedMintAccount));
const tokensState = getTokenDecoder().decode(accountBytes(simulatedTokensAccount));

const resultingState = {
  configTotalPower: configBytes.readBigUInt64LE(160),
  configTotalBurned: configBytes.readBigUInt64LE(192),
  minerByteLength: minerBytes.length,
  minerPower: minerBytes.readBigUInt64LE(40),
  minerSlotZeroLevel: minerBytes.readUInt8(48),
  minerTotalBurned: minerBytes.readBigUInt64LE(97),
  minerBump: minerBytes.readUInt8(121),
  mintSupply: mintState.supply,
  authorityTokenBalance: tokensState.amount,
};

const passed =
  simulation.err === null &&
  resultingState.configTotalPower === 1n &&
  resultingState.configTotalBurned === BUILD_BURN_RAW &&
  resultingState.minerByteLength === 122 &&
  resultingState.minerPower === 1n &&
  resultingState.minerSlotZeroLevel === 1 &&
  resultingState.minerTotalBurned === BUILD_BURN_RAW &&
  resultingState.minerBump === minerBump &&
  resultingState.mintSupply === 91_999_000_000_000n &&
  resultingState.authorityTokenBalance === 27_599_000_000_000n;

console.log(
  JSON.stringify(
    {
      passed,
      broadcast: false,
      cluster: "devnet",
      scenario: "initialize canonical miner and build level 1 rig in slot 0",
      miner,
      burnRaw: BUILD_BURN_RAW,
      burnUsr: "1000",
      unitsConsumed: simulation.unitsConsumed ?? null,
      resultingState,
      logs: simulation.logs ?? [],
    },
    jsonReplacer,
    2,
  ),
);

if (!passed) process.exitCode = 1;

