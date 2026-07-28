import {
  address,
  createSolanaRpc,
  getAddressEncoder,
  getProgramDerivedAddress,
  isNone,
  signature,
} from "@solana/kit";
import { getMintDecoder, getTokenDecoder } from "@solana-program/token";

const RPC_URL = process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = address("4ZssVwZYsfPAdoWozYyxPHFYts5uohJBHWCQo6yEm5AC");
const AUTHORITY = address("GHzzAsZq4oR6ZsqG1Mksgxyfm1X874KXGVRxNh65C2S5");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const BOOTSTRAP_SIGNATURE = signature(
  process.env.USR_BOOTSTRAP_SIGNATURE ??
    "4wVvZDTUVBC2CagKppK4XsYgg3XrWofo1E3HoPoPkQd9ggKxvmyVyQE59Wd6KbPFuSZ7mCPukp9rZqYiCfNbgHLh",
);

const rpc = createSolanaRpc(RPC_URL);
const addressEncoder = getAddressEncoder();

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function accountBytes(accountInfo) {
  if (!accountInfo || !Array.isArray(accountInfo.data) || accountInfo.data[1] !== "base64") {
    throw new Error("Expected a live base64-encoded account");
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
const [mint] = await getProgramDerivedAddress({
  programAddress: PROGRAM_ID,
  seeds: ["usr-mint", addressEncoder.encode(AUTHORITY)],
});
const [rewardVault] = await deriveAta(config, mint);
const [authorityTokens] = await deriveAta(AUTHORITY, mint);

const [accountsResponse, signatureStatusResponse, authorityBalanceResponse] = await Promise.all([
  rpc
    .getMultipleAccounts([config, mint, rewardVault, authorityTokens], {
      commitment: "confirmed",
      encoding: "base64",
    })
    .send(),
  rpc
    .getSignatureStatuses([BOOTSTRAP_SIGNATURE], { searchTransactionHistory: true })
    .send(),
  rpc.getBalance(AUTHORITY, { commitment: "confirmed" }).send(),
]);

const [configAccount, mintAccount, rewardVaultAccount, authorityTokensAccount] =
  accountsResponse.value;
if ([configAccount, mintAccount, rewardVaultAccount, authorityTokensAccount].some((item) => !item)) {
  throw new Error("One or more Uranium Strategy Devnet accounts are missing");
}

const configBytes = accountBytes(configAccount);
const mintState = getMintDecoder().decode(accountBytes(mintAccount));
const rewardState = getTokenDecoder().decode(accountBytes(rewardVaultAccount));
const treasuryState = getTokenDecoder().decode(accountBytes(authorityTokensAccount));
const status = signatureStatusResponse.value[0];

const decodedConfig = {
  byteLength: configBytes.length,
  authorityMatches: bytesEqual(configBytes.subarray(8, 40), addressEncoder.encode(AUTHORITY)),
  mintMatches: bytesEqual(configBytes.subarray(40, 72), addressEncoder.encode(mint)),
  rewardVaultMatches: bytesEqual(
    configBytes.subarray(72, 104),
    addressEncoder.encode(rewardVault),
  ),
  fixedSupply: configBytes.readBigUInt64LE(104),
  startTs: configBytes.readBigInt64LE(112),
  seasonEndTs: configBytes.readBigInt64LE(120),
  lastUpdateTs: configBytes.readBigInt64LE(128),
  halvingIntervalSeconds: configBytes.readBigInt64LE(136),
  baseEmissionPerSecond: configBytes.readBigUInt64LE(144),
  minBuildCost: configBytes.readBigUInt64LE(152),
  totalPower: configBytes.readBigUInt64LE(160),
  reserveFunded: configBytes.readBigUInt64LE(168),
  rewardsAllocated: configBytes.readBigUInt64LE(176),
  rewardsClaimed: configBytes.readBigUInt64LE(184),
  totalBurned: configBytes.readBigUInt64LE(192),
  accRewardPerPower:
    configBytes.readBigUInt64LE(200) + (configBytes.readBigUInt64LE(208) << 64n),
  claimFeeBps: configBytes.readUInt16LE(216),
  compoundFeeBps: configBytes.readUInt16LE(218),
  mintDecimals: configBytes.readUInt8(220),
  version: configBytes.readUInt8(221),
  paused: configBytes.readUInt8(222) !== 0,
  bump: configBytes.readUInt8(223),
};

const passed =
  status?.err === null &&
  (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") &&
  configAccount.owner === PROGRAM_ID &&
  mintAccount.owner === TOKEN_PROGRAM &&
  rewardVaultAccount.owner === TOKEN_PROGRAM &&
  authorityTokensAccount.owner === TOKEN_PROGRAM &&
  decodedConfig.byteLength === 224 &&
  decodedConfig.authorityMatches &&
  decodedConfig.mintMatches &&
  decodedConfig.rewardVaultMatches &&
  decodedConfig.fixedSupply === 92_000_000_000_000n &&
  decodedConfig.seasonEndTs === 1_792_782_286n &&
  decodedConfig.halvingIntervalSeconds === 604_800n &&
  decodedConfig.baseEmissionPerSecond === 50_000_000n &&
  decodedConfig.minBuildCost === 1_000_000_000n &&
  decodedConfig.totalPower === 0n &&
  decodedConfig.reserveFunded === 64_400_000_000_000n &&
  decodedConfig.rewardsAllocated === 0n &&
  decodedConfig.rewardsClaimed === 0n &&
  decodedConfig.totalBurned === 0n &&
  decodedConfig.accRewardPerPower === 0n &&
  decodedConfig.claimFeeBps === 200 &&
  decodedConfig.compoundFeeBps === 75 &&
  decodedConfig.mintDecimals === 6 &&
  decodedConfig.version === 1 &&
  !decodedConfig.paused &&
  decodedConfig.bump === configBump &&
  mintState.supply === 92_000_000_000_000n &&
  mintState.decimals === 6 &&
  mintState.isInitialized &&
  isNone(mintState.mintAuthority) &&
  isNone(mintState.freezeAuthority) &&
  rewardState.mint === mint &&
  rewardState.owner === config &&
  rewardState.amount === 64_400_000_000_000n &&
  treasuryState.mint === mint &&
  treasuryState.owner === AUTHORITY &&
  treasuryState.amount === 27_600_000_000_000n;

const report = {
  passed,
  cluster: "devnet",
  transaction: {
    signature: BOOTSTRAP_SIGNATURE,
    status,
  },
  authority: {
    address: AUTHORITY,
    balanceLamports: authorityBalanceResponse.value,
  },
  addresses: {
    program: PROGRAM_ID,
    config,
    mint,
    rewardVault,
    authorityTokens,
  },
  config: decodedConfig,
  mint: mintState,
  rewardVault: rewardState,
  authorityTokens: treasuryState,
};

console.log(JSON.stringify(report, jsonReplacer, 2));
if (!passed) process.exitCode = 1;

