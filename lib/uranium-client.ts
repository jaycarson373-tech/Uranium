import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
  type AccountSignerMeta,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";

export const TOKEN_DECIMALS = 6;
export const TOKEN_SCALE = 10n ** BigInt(TOKEN_DECIMALS);
export const ACC_SCALE = 1_000_000_000_000n;
export const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");

const DISCRIMINATORS = {
  initializeMiner: Uint8Array.from([170, 106, 254, 94, 49, 203, 51, 79]),
  buildRig: Uint8Array.from([242, 11, 116, 19, 182, 76, 114, 79]),
  claimRewards: Uint8Array.from([4, 144, 132, 71, 116, 23, 151, 80]),
  compoundRewards: Uint8Array.from([254, 191, 226, 120, 82, 115, 5, 87]),
} as const;

export type ProtocolAddresses = {
  program: Address;
  mint: Address;
  config: Address;
  rewardVault: Address;
};

export type MinerState = {
  address: Address;
  power: bigint;
  rigLevels: number[];
  accruedRewards: bigint;
  rewardDebt: bigint;
  totalBurned: bigint;
  totalClaimed: bigint;
  totalCompounded: bigint;
};

export type ProtocolState = {
  startTs: bigint;
  seasonEndTs: bigint;
  lastUpdateTs: bigint;
  halvingIntervalSeconds: bigint;
  baseEmissionPerSecond: bigint;
  minBuildCost: bigint;
  totalPower: bigint;
  reserveFunded: bigint;
  rewardsAllocated: bigint;
  rewardsClaimed: bigint;
  totalBurned: bigint;
  accRewardPerPower: bigint;
  claimFeeBps: number;
  compoundFeeBps: number;
  paused: boolean;
};

export type GameplaySnapshot = {
  miner: MinerState | null;
  protocol: ProtocolState;
  tokenBalance: bigint;
  pendingRewards: bigint;
  ownerTokens: Address;
  minerAddress: Address;
};

export type GameplayAction = "build" | "claim" | "compound";

export type GameplayInstructions = {
  instructions: Instruction[];
  minerAddress: Address;
  ownerTokens: Address;
};

type JsonRpcAccount = {
  data: [string, string];
};

function requiredAddress(name: string, value: string | undefined): Address {
  if (!value) throw new Error(`${name} is not configured`);
  return address(value);
}

export function getProtocolAddresses(): ProtocolAddresses {
  return {
    program: requiredAddress("NEXT_PUBLIC_USR_PROGRAM_ID", process.env.NEXT_PUBLIC_USR_PROGRAM_ID),
    mint: requiredAddress("NEXT_PUBLIC_USR_MINT", process.env.NEXT_PUBLIC_USR_MINT),
    config: requiredAddress("NEXT_PUBLIC_USR_CONFIG_PDA", process.env.NEXT_PUBLIC_USR_CONFIG_PDA),
    rewardVault: requiredAddress(
      "NEXT_PUBLIC_USR_REWARD_VAULT",
      process.env.NEXT_PUBLIC_USR_REWARD_VAULT,
    ),
  };
}

export function getCluster() {
  return process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
}

export function getRpcUrl() {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
}

export function formatTokenAmount(value: bigint, maximumFractionDigits = 2) {
  const whole = value / TOKEN_SCALE;
  const fraction = (value % TOKEN_SCALE).toString().padStart(TOKEN_DECIMALS, "0");
  const visible = fraction.slice(0, maximumFractionDigits).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${visible ? `.${visible}` : ""}`;
}

export function parseTokenAmount(value: string) {
  const normalized = value.trim().replaceAll(",", "");
  if (!/^\d+(\.\d{0,6})?$/.test(normalized)) throw new Error("Enter a valid USR amount");
  const [whole, fraction = ""] = normalized.split(".");
  const result =
    BigInt(whole) * TOKEN_SCALE +
    BigInt(fraction.padEnd(TOKEN_DECIMALS, "0") || "0");
  if (result <= 0n) throw new Error("Amount must be greater than zero");
  return result;
}

export function explorerUrl(signature: string) {
  const cluster = getCluster();
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${encodeURIComponent(cluster)}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

function u64(value: bigint) {
  if (value < 0n || value > 18_446_744_073_709_551_615n) {
    throw new Error("Value does not fit in u64");
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, item) => total + item.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function readU64(data: Uint8Array, offset: number) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

function readI64(data: Uint8Array, offset: number) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(offset, true);
}

function readU128(data: Uint8Array, offset: number) {
  return readU64(data, offset) + (readU64(data, offset + 8) << 64n);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function rpc<T>(method: string, params: unknown[]) {
  const response = await fetch(getRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Solana RPC returned HTTP ${response.status}`);
  const body = (await response.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (body.error) throw new Error(body.error.message ?? "Solana RPC request failed");
  if (body.result === undefined) throw new Error("Solana RPC returned no result");
  return body.result;
}

async function getAccountData(accountAddress: Address) {
  const result = await rpc<{ value: JsonRpcAccount | null }>("getAccountInfo", [
    accountAddress,
    { encoding: "base64", commitment: "confirmed" },
  ]);
  return result.value ? decodeBase64(result.value.data[0]) : null;
}

export async function deriveMinerAddress(
  program: Address,
  config: Address,
  owner: Address,
) {
  const [minerAddress] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: [
      getUtf8Encoder().encode("miner"),
      getAddressEncoder().encode(config),
      getAddressEncoder().encode(owner),
    ],
  });
  return minerAddress;
}

export async function deriveOwnerTokenAddress(owner: Address, mint: Address) {
  const [ownerTokens] = await findAssociatedTokenPda({
    owner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint,
  });
  return ownerTokens;
}

export function decodeProtocolState(data: Uint8Array): ProtocolState {
  if (data.length < 224) throw new Error("Protocol account data is truncated");
  return {
    startTs: readI64(data, 112),
    seasonEndTs: readI64(data, 120),
    lastUpdateTs: readI64(data, 128),
    halvingIntervalSeconds: readI64(data, 136),
    baseEmissionPerSecond: readU64(data, 144),
    minBuildCost: readU64(data, 152),
    totalPower: readU64(data, 160),
    reserveFunded: readU64(data, 168),
    rewardsAllocated: readU64(data, 176),
    rewardsClaimed: readU64(data, 184),
    totalBurned: readU64(data, 192),
    accRewardPerPower: readU128(data, 200),
    claimFeeBps: data[216] + data[217] * 256,
    compoundFeeBps: data[218] + data[219] * 256,
    paused: data[222] === 1,
  };
}

export function decodeMinerState(data: Uint8Array, minerAddress: Address): MinerState {
  if (data.length < 122) throw new Error("Miner account data is truncated");
  return {
    address: minerAddress,
    power: readU64(data, 40),
    rigLevels: Array.from(data.slice(48, 73)),
    accruedRewards: readU64(data, 73),
    rewardDebt: readU128(data, 81),
    totalBurned: readU64(data, 97),
    totalClaimed: readU64(data, 105),
    totalCompounded: readU64(data, 113),
  };
}

function emissionBetween(
  start: bigint,
  from: bigint,
  to: bigint,
  interval: bigint,
  baseRate: bigint,
) {
  if (to <= from || to <= start || interval <= 0n) return 0n;
  let cursor = from > start ? from : start;
  let total = 0n;
  while (cursor < to) {
    const epoch = (cursor - start) / interval;
    if (epoch >= 64n) break;
    const rate = baseRate >> epoch;
    if (rate === 0n) break;
    const epochEnd = start + (epoch + 1n) * interval;
    const segmentEnd = epochEnd < to ? epochEnd : to;
    total += (segmentEnd - cursor) * rate;
    cursor = segmentEnd;
  }
  return total;
}

export function estimatePendingRewards(
  protocol: ProtocolState,
  miner: MinerState | null,
  nowSeconds = BigInt(Math.floor(Date.now() / 1_000)),
) {
  if (!miner) return 0n;
  let accumulator = protocol.accRewardPerPower;
  const end = nowSeconds < protocol.seasonEndTs ? nowSeconds : protocol.seasonEndTs;
  const from = protocol.lastUpdateTs > protocol.startTs
    ? protocol.lastUpdateTs
    : protocol.startTs;
  if (end > from && protocol.totalPower > 0n) {
    const scheduled = emissionBetween(
      protocol.startTs,
      from,
      end,
      protocol.halvingIntervalSeconds,
      protocol.baseEmissionPerSecond,
    );
    const available = protocol.reserveFunded - protocol.rewardsAllocated;
    const reward = scheduled < available ? scheduled : available;
    accumulator += (reward * ACC_SCALE) / protocol.totalPower;
  }
  const accumulated = (miner.power * accumulator) / ACC_SCALE;
  const unsettled = accumulated > miner.rewardDebt ? accumulated - miner.rewardDebt : 0n;
  return miner.accruedRewards + unsettled;
}

export async function fetchGameplaySnapshot(owner: Address): Promise<GameplaySnapshot> {
  const addresses = getProtocolAddresses();
  const [minerAddress, ownerTokens] = await Promise.all([
    deriveMinerAddress(addresses.program, addresses.config, owner),
    deriveOwnerTokenAddress(owner, addresses.mint),
  ]);
  const [protocolData, minerData, tokenBalanceResult] = await Promise.all([
    getAccountData(addresses.config),
    getAccountData(minerAddress),
    rpc<{ value: { amount: string } }>("getTokenAccountBalance", [ownerTokens, { commitment: "confirmed" }])
      .catch(() => null),
  ]);
  if (!protocolData) throw new Error("Protocol configuration account was not found");
  const protocol = decodeProtocolState(protocolData);
  const miner = minerData ? decodeMinerState(minerData, minerAddress) : null;
  return {
    protocol,
    miner,
    tokenBalance: tokenBalanceResult ? BigInt(tokenBalanceResult.value.amount) : 0n,
    pendingRewards: estimatePendingRewards(protocol, miner),
    ownerTokens,
    minerAddress,
  };
}

export async function createGameplayInstructions({
  action,
  ownerSigner,
  slot,
  amount,
  initializeMiner,
}: {
  action: GameplayAction;
  ownerSigner: TransactionSigner;
  slot: number;
  amount?: bigint;
  initializeMiner?: boolean;
}): Promise<GameplayInstructions> {
  const addresses = getProtocolAddresses();
  if (!Number.isInteger(slot) || slot < 0 || slot > 24) throw new Error("Invalid reserve slot");
  const [minerAddress, ownerTokens] = await Promise.all([
    deriveMinerAddress(addresses.program, addresses.config, ownerSigner.address),
    deriveOwnerTokenAddress(ownerSigner.address, addresses.mint),
  ]);
  const instructions: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: ownerSigner,
      ata: ownerTokens,
      owner: ownerSigner.address,
      mint: addresses.mint,
    }),
  ];
  const ownerWritable = {
    address: ownerSigner.address,
    role: AccountRole.WRITABLE_SIGNER,
    signer: ownerSigner,
  } satisfies AccountSignerMeta;
  const ownerReadonly = {
    address: ownerSigner.address,
    role: AccountRole.READONLY_SIGNER,
    signer: ownerSigner,
  } satisfies AccountSignerMeta;
  if (initializeMiner) {
    instructions.push({
      programAddress: addresses.program,
      accounts: [
        ownerWritable,
        { address: addresses.config, role: AccountRole.READONLY },
        { address: minerAddress, role: AccountRole.WRITABLE },
        { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      ],
      data: DISCRIMINATORS.initializeMiner,
    });
  }

  if (action === "build") {
    if (!amount) throw new Error("Build amount is required");
    instructions.push({
      programAddress: addresses.program,
      accounts: [
        ownerReadonly,
        { address: addresses.config, role: AccountRole.WRITABLE },
        { address: minerAddress, role: AccountRole.WRITABLE },
        { address: addresses.mint, role: AccountRole.WRITABLE },
        { address: ownerTokens, role: AccountRole.WRITABLE },
        { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      ],
      data: concat(DISCRIMINATORS.buildRig, Uint8Array.of(slot), u64(amount)),
    });
  } else if (action === "claim") {
    instructions.push({
      programAddress: addresses.program,
      accounts: [
        ownerReadonly,
        { address: addresses.config, role: AccountRole.WRITABLE },
        { address: minerAddress, role: AccountRole.WRITABLE },
        { address: addresses.mint, role: AccountRole.WRITABLE },
        { address: addresses.rewardVault, role: AccountRole.WRITABLE },
        { address: ownerTokens, role: AccountRole.WRITABLE },
        { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      ],
      data: DISCRIMINATORS.claimRewards,
    });
  } else {
    instructions.push({
      programAddress: addresses.program,
      accounts: [
        ownerReadonly,
        { address: addresses.config, role: AccountRole.WRITABLE },
        { address: minerAddress, role: AccountRole.WRITABLE },
        { address: addresses.mint, role: AccountRole.WRITABLE },
        { address: addresses.rewardVault, role: AccountRole.WRITABLE },
        { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      ],
      data: concat(DISCRIMINATORS.compoundRewards, Uint8Array.of(slot)),
    });
  }

  return { instructions, minerAddress, ownerTokens };
}
