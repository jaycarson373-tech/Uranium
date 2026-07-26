"use client";

import { createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { walletSigner } from "@solana/kit-plugin-wallet";
import { ClientProvider } from "@solana/react";

const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
const rpcUrl =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const walletChain =
  cluster === "mainnet-beta"
    ? "solana:mainnet"
    : cluster === "testnet"
      ? "solana:testnet"
      : cluster === "localnet"
        ? "solana:localnet"
        : "solana:devnet";

export const solanaClient = createClient()
  .use(walletSigner({ chain: walletChain }))
  .use(solanaRpc({ rpcUrl }));

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClientProvider client={solanaClient}>{children}</ClientProvider>;
}
