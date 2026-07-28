import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getAddressEncoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  isNone,
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
const BOOTSTRAP_DISCRIMINATOR = Uint8Array.from([45, 209, 227, 206, 213, 188, 150, 210]);
const SEASON_SECONDS = 90 * 24 * 60 * 60;
const EXPECTED_PROGRAM_OWNER = "BPFLoaderUpgradeab1e11111111111111111111111";

const rpc = createSolanaRpc(RPC_URL);
const addressEncoder = getAddressEncoder();

function encodeI64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(value), true);
  return bytes;
}

function concatBytes(...chunks) {
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function accountDataBytes(accountInfo) {
  if (!accountInfo || !Array.isArray(accountInfo.data) || accountInfo.data[1] !== "base64") {
    throw new Error("Simulation did not return base64 account data");
  }
  return Buffer.from(accountInfo.data[0], "base64");
}

function bytesEqual(left, right) {
  return Buffer.from(left).equals(Buffer.from(right));
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

const [config, configBump] = await getProgramDerivedAddress({
  programAddress: PROGRAM_ID,
  seeds: ["config", addressEncoder.encode(AUTHORITY)],
});
const [mint, mintBump] = await getProgramDerivedAddress({
  programAddress: PROGRAM_ID,
  seeds: ["usr-mint", addressEncoder.encode(AUTHORITY)],
});
const [rewardVault] = await deriveAta(config, mint);
const [authorityTokens] = await deriveAta(AUTHORITY, mint);

const programAccountResponse = await rpc
  .getAccountInfo(PROGRAM_ID, { commitment: "confirmed", encoding: "base64" })
  .send();
const programAccount = programAccountResponse.value;
if (!programAccount) {
  throw new Error(`Program ${PROGRAM_ID} does not exist on Devnet`);
}
if (!programAccount.executable || programAccount.owner !== EXPECTED_PROGRAM_OWNER) {
  throw new Error(`Program account is not an executable upgradeable-loader program`);
}

const stateAccountsResponse = await rpc
  .getMultipleAccounts([config, mint, rewardVault, authorityTokens], {
    commitment: "confirmed",
    encoding: "base64",
  })
  .send();
const existingState = stateAccountsResponse.value.map((accountInfo) => accountInfo !== null);

const authorityBalanceResponse = await rpc.getBalance(AUTHORITY, { commitment: "confirmed" }).send();
const requestedSeasonEndTs = process.env.USR_SEASON_END_TS;
const seasonEndTs = requestedSeasonEndTs
  ? Number.parseInt(requestedSeasonEndTs, 10)
  : Math.floor(Date.now() / 1000) + SEASON_SECONDS;
if (!Number.isSafeInteger(seasonEndTs) || seasonEndTs <= Math.floor(Date.now() / 1000)) {
  throw new Error("USR_SEASON_END_TS must be a future Unix timestamp");
}
const latestBlockhashResponse = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();

const bootstrapInstruction = {
  programAddress: PROGRAM_ID,
  accounts: [
    { address: AUTHORITY, role: AccountRole.WRITABLE_SIGNER },
    { address: config, role: AccountRole.WRITABLE },
    { address: mint, role: AccountRole.WRITABLE },
    { address: rewardVault, role: AccountRole.WRITABLE },
    { address: authorityTokens, role: AccountRole.WRITABLE },
    { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
    { address: ASSOCIATED_TOKEN_PROGRAM, role: AccountRole.READONLY },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
  ],
  data: concatBytes(BOOTSTRAP_DISCRIMINATOR, encodeI64(seasonEndTs)),
};

const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (message) => setTransactionMessageFeePayer(AUTHORITY, message),
  (message) =>
    setTransactionMessageLifetimeUsingBlockhash(latestBlockhashResponse.value, message),
  (message) => appendTransactionMessageInstruction(bootstrapInstruction, message),
);
const transaction = compileTransaction(transactionMessage);
const wireTransaction = getBase64EncodedWireTransaction(transaction);
const messageBase64 = getBase64Decoder().decode(transaction.messageBytes);

const [simulationResponse, feeResponse, configRent, mintRent, ataRent] = await Promise.all([
  rpc
    .simulateTransaction(wireTransaction, {
      commitment: "confirmed",
      encoding: "base64",
      sigVerify: false,
      innerInstructions: true,
      accounts: {
        addresses: [config, mint, rewardVault, authorityTokens],
        encoding: "base64",
      },
    })
    .send(),
  rpc.getFeeForMessage(messageBase64, { commitment: "confirmed" }).send(),
  rpc.getMinimumBalanceForRentExemption(224n, { commitment: "confirmed" }).send(),
  rpc.getMinimumBalanceForRentExemption(82n, { commitment: "confirmed" }).send(),
  rpc.getMinimumBalanceForRentExemption(165n, { commitment: "confirmed" }).send(),
]);

const simulation = simulationResponse.value;
const [simulatedConfigAccount, simulatedMintAccount, simulatedRewardVault, simulatedAuthorityTokens] =
  simulation.accounts ?? [];
const simulatedConfigBytes = accountDataBytes(simulatedConfigAccount);
const simulatedMint = getMintDecoder().decode(accountDataBytes(simulatedMintAccount));
const simulatedRewardTokens = getTokenDecoder().decode(accountDataBytes(simulatedRewardVault));
const simulatedTreasuryTokens = getTokenDecoder().decode(accountDataBytes(simulatedAuthorityTokens));

const simulatedConfig = {
  byteLength: simulatedConfigBytes.length,
  authorityMatches: bytesEqual(simulatedConfigBytes.subarray(8, 40), addressEncoder.encode(AUTHORITY)),
  mintMatches: bytesEqual(simulatedConfigBytes.subarray(40, 72), addressEncoder.encode(mint)),
  rewardVaultMatches: bytesEqual(
    simulatedConfigBytes.subarray(72, 104),
    addressEncoder.encode(rewardVault),
  ),
  fixedSupply: simulatedConfigBytes.readBigUInt64LE(104),
  startTs: simulatedConfigBytes.readBigInt64LE(112),
  seasonEndTs: simulatedConfigBytes.readBigInt64LE(120),
  lastUpdateTs: simulatedConfigBytes.readBigInt64LE(128),
  halvingIntervalSeconds: simulatedConfigBytes.readBigInt64LE(136),
  baseEmissionPerSecond: simulatedConfigBytes.readBigUInt64LE(144),
  minBuildCost: simulatedConfigBytes.readBigUInt64LE(152),
  totalPower: simulatedConfigBytes.readBigUInt64LE(160),
  reserveFunded: simulatedConfigBytes.readBigUInt64LE(168),
  rewardsAllocated: simulatedConfigBytes.readBigUInt64LE(176),
  rewardsClaimed: simulatedConfigBytes.readBigUInt64LE(184),
  totalBurned: simulatedConfigBytes.readBigUInt64LE(192),
  accRewardPerPower:
    simulatedConfigBytes.readBigUInt64LE(200) +
    (simulatedConfigBytes.readBigUInt64LE(208) << 64n),
  claimFeeBps: simulatedConfigBytes.readUInt16LE(216),
  compoundFeeBps: simulatedConfigBytes.readUInt16LE(218),
  mintDecimals: simulatedConfigBytes.readUInt8(220),
  version: simulatedConfigBytes.readUInt8(221),
  paused: simulatedConfigBytes.readUInt8(222) !== 0,
  bump: simulatedConfigBytes.readUInt8(223),
};

const simulatedStateValid =
  simulatedConfig.byteLength === 224 &&
  simulatedConfig.authorityMatches &&
  simulatedConfig.mintMatches &&
  simulatedConfig.rewardVaultMatches &&
  simulatedConfig.fixedSupply === 92_000_000_000_000n &&
  simulatedConfig.seasonEndTs === BigInt(seasonEndTs) &&
  simulatedConfig.halvingIntervalSeconds === 604_800n &&
  simulatedConfig.baseEmissionPerSecond === 50_000_000n &&
  simulatedConfig.minBuildCost === 1_000_000_000n &&
  simulatedConfig.totalPower === 0n &&
  simulatedConfig.reserveFunded === 64_400_000_000_000n &&
  simulatedConfig.rewardsAllocated === 0n &&
  simulatedConfig.rewardsClaimed === 0n &&
  simulatedConfig.totalBurned === 0n &&
  simulatedConfig.accRewardPerPower === 0n &&
  simulatedConfig.claimFeeBps === 200 &&
  simulatedConfig.compoundFeeBps === 75 &&
  simulatedConfig.mintDecimals === 6 &&
  simulatedConfig.version === 1 &&
  !simulatedConfig.paused &&
  simulatedConfig.bump === configBump &&
  simulatedMint.supply === 92_000_000_000_000n &&
  simulatedMint.decimals === 6 &&
  simulatedMint.isInitialized &&
  isNone(simulatedMint.mintAuthority) &&
  isNone(simulatedMint.freezeAuthority) &&
  simulatedRewardTokens.mint === mint &&
  simulatedRewardTokens.owner === config &&
  simulatedRewardTokens.amount === 64_400_000_000_000n &&
  simulatedTreasuryTokens.mint === mint &&
  simulatedTreasuryTokens.owner === AUTHORITY &&
  simulatedTreasuryTokens.amount === 27_600_000_000_000n;

const rentLamports = configRent + mintRent + ataRent * 2n;
const feeLamports = feeResponse.value ?? 0n;
const requiredLamports = rentLamports + feeLamports;
const passed =
  simulation.err === null &&
  simulatedStateValid &&
  existingState.every((exists) => !exists) &&
  authorityBalanceResponse.value >= requiredLamports;

const report = {
  passed,
  cluster: "devnet",
  rpcUrl: RPC_URL,
  program: {
    address: PROGRAM_ID,
    executable: programAccount.executable,
    owner: programAccount.owner,
  },
  authority: {
    address: AUTHORITY,
    balanceLamports: authorityBalanceResponse.value,
  },
  bootstrap: {
    seasonEndTs,
    seasonEndUtc: new Date(seasonEndTs * 1000).toISOString(),
    config,
    configBump,
    mint,
    mintBump,
    rewardVault,
    authorityTokens,
    accountsAlreadyExist: existingState,
    fixedSupplyRaw: "92000000000000",
    fixedSupplyUsr: "92000000",
    rewardReserveRaw: "64400000000000",
    rewardReserveUsr: "64400000",
    treasuryRaw: "27600000000000",
    treasuryUsr: "27600000",
  },
  cost: {
    rentLamports,
    transactionFeeLamports: feeLamports,
    totalLamports: requiredLamports,
  },
  simulation: {
    err: simulation.err,
    unitsConsumed: simulation.unitsConsumed ?? null,
    stateValid: simulatedStateValid,
    resultingState: {
      config: simulatedConfig,
      mint: simulatedMint,
      rewardVault: simulatedRewardTokens,
      authorityTokens: simulatedTreasuryTokens,
    },
    logs: simulation.logs ?? [],
  },
};

console.log(JSON.stringify(report, jsonReplacer, 2));

if (!passed) {
  process.exitCode = 1;
}

