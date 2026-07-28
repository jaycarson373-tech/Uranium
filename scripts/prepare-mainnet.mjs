import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
} from "@solana-program/token";

const DEVNET_PROGRAM_ID = "4ZssVwZYsfPAdoWozYyxPHFYts5uohJBHWCQo6yEm5AC";
const RPC_URL = process.env.MAINNET_RPC_HTTP_URL;
const program = process.env.MAINNET_PROGRAM_ID;
const authority = process.env.SQUADS_VAULT_ADDRESS;

if (!RPC_URL || !program || !authority) {
  throw new Error(
    "Set MAINNET_RPC_HTTP_URL, MAINNET_PROGRAM_ID, and SQUADS_VAULT_ADDRESS. Public addresses only.",
  );
}
if (program === DEVNET_PROGRAM_ID) {
  throw new Error("Mainnet must use a new program ID, not the Devnet program ID");
}
if (!RPC_URL.startsWith("https://")) {
  throw new Error("MAINNET_RPC_HTTP_URL must use HTTPS");
}

const programAddress = address(program);
const authorityAddress = address(authority);
const addressEncoder = getAddressEncoder();

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

const genesisHash = await rpc("getGenesisHash");
if (genesisHash !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") {
  throw new Error(`RPC is not Solana Mainnet-Beta (genesis ${genesisHash})`);
}

const [config] = await getProgramDerivedAddress({
  programAddress,
  seeds: ["config", addressEncoder.encode(authorityAddress)],
});
const [mint] = await getProgramDerivedAddress({
  programAddress,
  seeds: ["usr-mint", addressEncoder.encode(authorityAddress)],
});
const [rewardVault] = await findAssociatedTokenPda({
  owner: config,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
  mint,
});
const [treasuryAta] = await findAssociatedTokenPda({
  owner: authorityAddress,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
  mint,
});

const [existingProgram, authorityBalance, rentConfig, rentMint, rentToken] =
  await Promise.all([
    rpc("getAccountInfo", [programAddress, { encoding: "base64", commitment: "confirmed" }]),
    rpc("getBalance", [authorityAddress, { commitment: "confirmed" }]),
    rpc("getMinimumBalanceForRentExemption", [224]),
    rpc("getMinimumBalanceForRentExemption", [82]),
    rpc("getMinimumBalanceForRentExemption", [165]),
  ]);

if (existingProgram.value) {
  throw new Error("MAINNET_PROGRAM_ID already has an account; verify custody before continuing");
}

const bootstrapRentLamports =
  BigInt(rentConfig) + BigInt(rentMint) + BigInt(rentToken) * 2n;

console.log(JSON.stringify({
  readyForHumanReview: true,
  transactionSent: false,
  cluster: "mainnet-beta",
  genesisHash,
  addresses: {
    program: programAddress,
    squadsAuthority: authorityAddress,
    config,
    mint,
    rewardVault,
    treasuryAta,
  },
  fixedEconomics: {
    supplyUsr: "92000000",
    rewardReserveUsr: "64400000",
    treasuryUsr: "27600000",
    decimals: 6,
    baseEmissionUsrPerSecond: "50",
    halvingSeconds: "604800",
    minBuildUsr: "1000",
    claimFeeBps: 200,
    compoundFeeBps: 75,
  },
  funding: {
    squadsVaultBalanceLamports: String(authorityBalance.value),
    minimumBootstrapAccountRentLamports: String(bootstrapRentLamports),
    deploymentRentNotIncluded: true,
  },
  requiredSourceChanges: {
    declareId: `declare_id!("${programAddress}");`,
    anchorMainnet: `uranium_strategy = "${programAddress}"`,
  },
  frontendEnvironmentAfterVerifiedBootstrap: {
    NEXT_PUBLIC_SOLANA_CLUSTER: "mainnet-beta",
    NEXT_PUBLIC_SOLANA_RPC_URL: "<public production RPC URL>",
    NEXT_PUBLIC_USR_PROGRAM_ID: programAddress,
    NEXT_PUBLIC_USR_MINT: mint,
    NEXT_PUBLIC_USR_CONFIG_PDA: config,
    NEXT_PUBLIC_USR_REWARD_VAULT: rewardVault,
    NEXT_PUBLIC_INDEXER_API_URL: "<mainnet Railway indexer URL>",
  },
}, null, 2));
