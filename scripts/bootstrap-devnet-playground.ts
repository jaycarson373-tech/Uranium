// Approved Uranium Strategy Devnet bootstrap.
// Run only in Solana Playground with the expected Playground wallet connected.

const EXPECTED_DEVNET_GENESIS =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const EXPECTED_AUTHORITY =
  "GHzzAsZq4oR6ZsqG1Mksgxyfm1X874KXGVRxNh65C2S5";
const PROGRAM_ID = new web3.PublicKey(
  "4ZssVwZYsfPAdoWozYyxPHFYts5uohJBHWCQo6yEm5AC",
);
const TOKEN_PROGRAM_ID = new web3.PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new web3.PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const SEASON_END_TS = 1_792_782_286n;
const BOOTSTRAP_DISCRIMINATOR = Uint8Array.from([
  45, 209, 227, 206, 213, 188, 150, 210,
]);

if (!pg.wallet) {
  throw new Error("Connect the Solana Playground wallet before running");
}
if (pg.wallet.publicKey.toString() !== EXPECTED_AUTHORITY) {
  throw new Error(
    `Wrong authority: expected ${EXPECTED_AUTHORITY}, received ${pg.wallet.publicKey}`,
  );
}

const genesisHash = await pg.connection.getGenesisHash();
if (genesisHash !== EXPECTED_DEVNET_GENESIS) {
  throw new Error(`Wrong cluster: expected Devnet, received genesis ${genesisHash}`);
}
console.log("URANIUM_BOOTSTRAP_STAGE", "devnet-and-authority-verified");

const authority = pg.wallet.publicKey;
const [config] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("config"), authority.toBuffer()],
  PROGRAM_ID,
);
const [mint] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("usr-mint"), authority.toBuffer()],
  PROGRAM_ID,
);
const [rewardVault] = web3.PublicKey.findProgramAddressSync(
  [config.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
  ASSOCIATED_TOKEN_PROGRAM_ID,
);
const [authorityTokens] = web3.PublicKey.findProgramAddressSync(
  [authority.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
  ASSOCIATED_TOKEN_PROGRAM_ID,
);

const expectedAddresses = {
  config: "24P7GQNwrNQnNojxipxAYR8nmBi3ZKWHoRB8zoetWX5A",
  mint: "6cBq44LrxdqWyZrPyvkydQ32hGPhYvErtt66eyM4KVEg",
  rewardVault: "1djxzK9KKKbfUpNSVDww3zFQqueEjCPLjrCkbU1V5X3",
  authorityTokens: "FShr2tWJicBUwysCAV3jrA3cLjz5KKAYMf1qhjfXVm1S",
};
const derivedAddresses = {
  config: config.toString(),
  mint: mint.toString(),
  rewardVault: rewardVault.toString(),
  authorityTokens: authorityTokens.toString(),
};
for (const [name, expected] of Object.entries(expectedAddresses)) {
  if (derivedAddresses[name] !== expected) {
    throw new Error(
      `Derived ${name} mismatch: expected ${expected}, received ${derivedAddresses[name]}`,
    );
  }
}

const existingAccounts = await pg.connection.getMultipleAccountsInfo([
  config,
  mint,
  rewardVault,
  authorityTokens,
]);
if (existingAccounts.some(Boolean)) {
  throw new Error("Bootstrap aborted because one or more target accounts already exist");
}
console.log("URANIUM_BOOTSTRAP_STAGE", "target-accounts-available");

const data = Buffer.alloc(16);
data.set(BOOTSTRAP_DISCRIMINATOR, 0);
data.writeBigInt64LE(SEASON_END_TS, 8);

const instruction = new web3.TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: rewardVault, isSigner: false, isWritable: true },
    { pubkey: authorityTokens, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});

const latestBlockhash = await pg.connection.getLatestBlockhash("confirmed");
const transaction = new web3.Transaction({
  feePayer: authority,
  blockhash: latestBlockhash.blockhash,
  lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
}).add(instruction);
console.log("URANIUM_BOOTSTRAP_STAGE", "transaction-built");

const simulation = await pg.connection.simulateTransaction(transaction);
if (simulation.value.err) {
  console.error(simulation.value.logs);
  throw new Error(`Bootstrap simulation failed: ${JSON.stringify(simulation.value.err)}`);
}

console.log("Approved Devnet bootstrap simulation passed", {
  authority: authority.toString(),
  program: PROGRAM_ID.toString(),
  seasonEndTs: SEASON_END_TS.toString(),
  addresses: derivedAddresses,
  unitsConsumed: simulation.value.unitsConsumed,
});

const signedTransaction = await pg.wallet.signTransaction(transaction);
const signature = await pg.connection.sendRawTransaction(
  signedTransaction.serialize(),
  {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 5,
  },
);
const confirmation = await pg.connection.confirmTransaction(
  {
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  },
  "confirmed",
);
if (confirmation.value.err) {
  throw new Error(
    `Bootstrap transaction failed: ${JSON.stringify(confirmation.value.err)}`,
  );
}

console.log("URANIUM_BOOTSTRAP_CONFIRMED", signature);

