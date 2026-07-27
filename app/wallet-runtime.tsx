"use client";

import {
  WalletReadyGate,
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import { useState } from "react";
import { Providers } from "./providers";
import type { WalletIslandProps } from "./wallet-island";

function shortAddress(value: string) {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function WalletControl({ compact = false }: { compact?: boolean }) {
  const wallets = useWallets();
  const connected = useConnectedWallet();
  const { dispatch: connect, isRunning: connecting } = useConnect();
  const { dispatch: disconnect, isRunning: disconnecting } = useDisconnect();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [walletError, setWalletError] = useState(false);

  const safelyConnect = (wallet: Parameters<typeof connect>[0]) => {
    setWalletError(false);
    Promise.resolve(connect(wallet)).catch(() => setWalletError(true));
  };

  const safelyDisconnect = () => {
    setWalletError(false);
    Promise.resolve(disconnect()).catch(() => setWalletError(true));
  };

  if (walletError) {
    return (
      <button
        className={`wallet-button ${compact ? "compact" : ""}`}
        type="button"
        onClick={() => setWalletError(false)}
        title="Retry wallet connection"
      >
        Wallet retry
      </button>
    );
  }

  if (connected) {
    return (
      <button
        className={`wallet-button connected ${compact ? "compact" : ""}`}
        type="button"
        disabled={disconnecting}
        onClick={safelyDisconnect}
        title="Disconnect wallet"
      >
        <span className="wallet-glyph" aria-hidden="true">▰</span>
        {disconnecting ? "Disconnecting" : shortAddress(connected.account.address)}
      </button>
    );
  }

  if (wallets.length === 0) {
    return (
      <a className="wallet-button wallet-link" href="https://phantom.com/" target="_blank" rel="noreferrer">
        Install wallet
      </a>
    );
  }

  return (
    <div className="wallet-picker">
      <button
        className={`wallet-button ${compact ? "compact" : ""}`}
        type="button"
        disabled={connecting}
        aria-expanded={pickerOpen}
        onClick={() => wallets.length === 1 ? safelyConnect(wallets[0]) : setPickerOpen((value) => !value)}
      >
        <span className="wallet-glyph" aria-hidden="true">▰</span>
        {connecting ? "Connecting" : "Connect wallet"}
      </button>
      {pickerOpen && (
        <div className="wallet-menu" role="menu">
          {wallets.map((wallet) => (
            <button key={wallet.name} type="button" role="menuitem" onClick={() => {
              setPickerOpen(false);
              safelyConnect(wallet);
            }}>
              <span className="wallet-menu-dot" aria-hidden="true" />
              {wallet.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function WalletPanel({ contractConfigured = true }: Pick<WalletIslandProps, "contractConfigured">) {
  const connected = useConnectedWallet();
  const stateLabel = !connected
    ? "Connect a Solana wallet to view your reserve"
    : !contractConfigured
      ? "Protocol configuration unavailable"
      : "Program connected · wallet actions activate at launch";

  return (
    <>
      <div className="console-status">
        <span className={`status-light ${connected ? "ready" : ""}`} />
        <div>
          <small>Solana protocol / beta</small>
          <strong>{stateLabel}</strong>
        </div>
      </div>
      <WalletControl />
    </>
  );
}

function RuntimeContent(props: WalletIslandProps) {
  if (props.variant === "compact") {
    return <WalletControl compact />;
  }

  return <WalletPanel contractConfigured={props.contractConfigured} />;
}

function RuntimeFallback(props: WalletIslandProps) {
  if (props.variant === "compact") {
    return (
      <button className="wallet-button compact" type="button" disabled>
        Connect wallet
      </button>
    );
  }

  return (
    <>
      <div className="console-status">
        <span className="status-light" />
        <div>
          <small>Solana protocol / beta</small>
          <strong>Connect a Solana wallet to view your reserve</strong>
        </div>
      </div>
      <button className="panel-wallet-placeholder" type="button" disabled>
        Connect wallet
      </button>
    </>
  );
}

export default function WalletRuntime(props: WalletIslandProps) {
  return (
    <Providers>
      <WalletReadyGate fallback={<RuntimeFallback {...props} />}>
        <RuntimeContent {...props} />
      </WalletReadyGate>
    </Providers>
  );
}
