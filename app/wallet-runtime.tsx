"use client";

import {
  WalletReadyGate,
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import { address } from "@solana/kit";
import { useClient } from "@solana/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createGameplayInstructions,
  explorerUrl,
  fetchGameplaySnapshot,
  formatTokenAmount,
  getCluster,
  getProtocolAddresses,
  parseTokenAmount,
  type GameplayAction,
  type GameplaySnapshot,
} from "../lib/uranium-client";
import { Providers, solanaClient } from "./providers";
import type { WalletIslandProps } from "./wallet-island";

const GRID = Array.from({ length: 25 }, (_, index) => index);
const INDEXER_URL = (process.env.NEXT_PUBLIC_INDEXER_API_URL ?? "").replace(/\/$/, "");

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
    try {
      connect(wallet);
    } catch {
      setWalletError(true);
    }
  };

  const safelyDisconnect = () => {
    setWalletError(false);
    try {
      disconnect();
    } catch {
      setWalletError(true);
    }
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

type Review = {
  action: GameplayAction;
  amount?: bigint;
};

type Leader = {
  rank: number;
  wallet: string;
  power: string;
  active_rigs: number;
};

function actionName(action: GameplayAction) {
  if (action === "build") return "Build rig";
  if (action === "claim") return "Claim rewards";
  return "Compound rewards";
}

function GamePanel({ contractConfigured = true }: Pick<WalletIslandProps, "contractConfigured">) {
  const connected = useConnectedWallet();
  const client = useClient<typeof solanaClient>();
  const [selectedSlot, setSelectedSlot] = useState(12);
  const [buildAmount, setBuildAmount] = useState("1,000");
  const [snapshot, setSnapshot] = useState<GameplaySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [signature, setSignature] = useState("");
  const [leaders, setLeaders] = useState<Leader[]>([]);

  const refresh = useCallback(async () => {
    if (!connected || !contractConfigured) {
      setSnapshot(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setSnapshot(await fetchGameplaySnapshot(address(connected.account.address)));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to load on-chain state");
    } finally {
      setLoading(false);
    }
  }, [connected, contractConfigured]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    if (!connected) {
      return () => window.clearTimeout(initial);
    }
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [connected, refresh]);

  useEffect(() => {
    if (!INDEXER_URL) return;
    const controller = new AbortController();
    fetch(`${INDEXER_URL}/leaderboard`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Indexer unavailable");
        return response.json();
      })
      .then((rows: Leader[]) => setLeaders(Array.isArray(rows) ? rows.slice(0, 3) : []))
      .catch(() => setLeaders([]));
    return () => controller.abort();
  }, [signature]);

  const stateLabel = !connected
    ? "Connect a Solana wallet to load your on-chain reserve"
    : !contractConfigured
      ? "Protocol configuration unavailable"
      : loading && !snapshot
        ? "Loading confirmed Solana state"
        : error && !snapshot
          ? "RPC unavailable · retry below"
          : snapshot?.protocol.paused
            ? "Protocol is paused · claims remain available"
            : "Program connected · transactions enabled";

  const reviewAction = (action: GameplayAction) => {
    setError("");
    setSignature("");
    if (!connected) {
      setError("Connect your wallet first");
      return;
    }
    if (!snapshot) {
      setError("Wait for the on-chain state to finish loading");
      return;
    }
    if (action !== "build" && !snapshot.miner) {
      setError("Build your first rig before claiming or compounding");
      return;
    }
    if (action === "claim" && snapshot.pendingRewards <= 0n) {
      setError("No rewards are currently available to claim");
      return;
    }
    if (
      action === "compound" &&
      (snapshot.pendingRewards * BigInt(10_000 - snapshot.protocol.compoundFeeBps)) /
        10_000n <
        snapshot.protocol.minBuildCost
    ) {
      setError(`At least ${formatTokenAmount(snapshot.protocol.minBuildCost)} productive USR is required`);
      return;
    }
    if (action === "build") {
      try {
        const amount = parseTokenAmount(buildAmount);
        if (amount < snapshot.protocol.minBuildCost) {
          throw new Error(`Minimum build is ${formatTokenAmount(snapshot.protocol.minBuildCost)} USR`);
        }
        if (amount % snapshot.protocol.minBuildCost !== 0n) {
          throw new Error(`Build in multiples of ${formatTokenAmount(snapshot.protocol.minBuildCost)} USR`);
        }
        if (amount > snapshot.tokenBalance) throw new Error("Insufficient USR balance");
        const levelIncrease = amount / snapshot.protocol.minBuildCost;
        const currentLevel = BigInt(snapshot.miner?.rigLevels[selectedSlot] ?? 0);
        if (currentLevel + levelIncrease > 100n) throw new Error("This rig cannot exceed level 100");
        setReview({ action, amount });
      } catch (amountError) {
        setError(amountError instanceof Error ? amountError.message : "Invalid build amount");
      }
      return;
    }
    setReview({ action });
  };

  const submitReviewedAction = async () => {
    if (!review || !snapshot || !connected) return;
    setSending(true);
    setError("");
    try {
      const { instructions } = await createGameplayInstructions({
        action: review.action,
        ownerSigner: client.identity,
        slot: selectedSlot,
        amount: review.amount,
        initializeMiner: review.action === "build" && !snapshot.miner,
      });
      const result = await client.sendTransaction(instructions);
      setSignature(String(result.context.signature));
      setReview(null);
      await refresh();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Transaction was not completed");
    } finally {
      setSending(false);
    }
  };

  const selectedLevel = snapshot?.miner?.rigLevels[selectedSlot] ?? 0;
  const claimNet = snapshot
    ? snapshot.pendingRewards -
      (snapshot.pendingRewards * BigInt(snapshot.protocol.claimFeeBps)) / 10_000n
    : 0n;
  const clusterLabel = getCluster() === "mainnet-beta" ? "Solana Mainnet" : "Solana Beta";
  const reviewAmount = useMemo(() => {
    if (!review || !snapshot) return "";
    if (review.action === "build") return `${formatTokenAmount(review.amount ?? 0n)} USR burned`;
    if (review.action === "claim") return `≈ ${formatTokenAmount(claimNet)} USR to wallet`;
    return `up to ${formatTokenAmount(snapshot.pendingRewards)} USR compounded`;
  }, [review, snapshot, claimNet]);

  return (
    <>
      <div className="console-toolbar">
        <div className="console-status">
          <span className={`status-light ${connected && snapshot ? "ready" : ""}`} />
          <div>
            <small>{clusterLabel} / confirmed</small>
            <strong>{stateLabel}</strong>
          </div>
        </div>
        <WalletControl />
      </div>

      <div className="console-metrics" aria-label="Wallet game statistics">
        <span><small>USR balance</small><strong>{snapshot ? formatTokenAmount(snapshot.tokenBalance) : "—"}</strong></span>
        <span><small>Mining power</small><strong>{snapshot?.miner?.power.toString() ?? "0"}</strong></span>
        <span><small>Pending</small><strong>{snapshot ? formatTokenAmount(snapshot.pendingRewards) : "—"} USR</strong></span>
        <span><small>Rig level</small><strong>{selectedLevel} / 100</strong></span>
      </div>

      <div className="console-layout">
        <div className="reserve-map">
          <div className="map-heading">
            <span>Your reserve / 5 × 5</span>
            <span>Slot {selectedSlot + 1}</span>
          </div>
          <div className="reserve-grid" aria-label="Reserve grid">
            {GRID.map((slot) => {
              const level = snapshot?.miner?.rigLevels[slot] ?? 0;
              return (
                <button
                  key={slot}
                  className={`${slot === selectedSlot ? "selected" : ""} ${level ? "active" : ""}`}
                  type="button"
                  aria-label={`Select reserve slot ${slot + 1}, level ${level}`}
                  aria-pressed={slot === selectedSlot}
                  onClick={() => {
                    setSelectedSlot(slot);
                    setReview(null);
                  }}
                >
                  {slot === selectedSlot ? "☢" : level || String(slot + 1).padStart(2, "0")}
                </button>
              );
            })}
          </div>
        </div>

        <div className="console-controls">
          <div className="control-card">
            <small>Selected cell</small>
            <strong>Uranium Rig #{selectedSlot + 1} · L{selectedLevel}</strong>
            <p>Burn USR to add permanent mining power to this wallet-owned on-chain cell.</p>
            <label>
              Build amount
              <span>
                <input
                  value={buildAmount}
                  inputMode="decimal"
                  aria-label="Build amount"
                  onChange={(event) => {
                    setBuildAmount(event.target.value);
                    setReview(null);
                  }}
                />
                USR
              </span>
            </label>
            <button
              type="button"
              disabled={!connected || !snapshot || snapshot.protocol.paused || sending}
              onClick={() => reviewAction("build")}
            >
              Review build transaction
            </button>
          </div>
          <div className="action-row">
            <button
              type="button"
              disabled={!connected || !snapshot?.miner || sending}
              onClick={() => reviewAction("claim")}
            >
              <small>≈ {formatTokenAmount(claimNet)} USR net</small>Claim rewards
            </button>
            <button
              type="button"
              disabled={!connected || !snapshot?.miner || snapshot?.protocol.paused || sending}
              onClick={() => reviewAction("compound")}
            >
              <small>0.75% protocol fee</small>Compound
            </button>
          </div>
        </div>
      </div>

      {review && connected && (
        <div className="transaction-review" role="status">
          <div>
            <small>Review before wallet approval</small>
            <strong>{actionName(review.action)} · Cell {selectedSlot + 1}</strong>
          </div>
          <dl>
            <div><dt>Cluster</dt><dd>{clusterLabel}</dd></div>
            <div><dt>Token effect</dt><dd>{reviewAmount}</dd></div>
            <div><dt>Fee payer</dt><dd>{shortAddress(connected.account.address)}</dd></div>
            <div><dt>Program</dt><dd>{shortAddress(getProtocolAddresses().program)}</dd></div>
            <div><dt>Network fee</dt><dd>Shown by wallet</dd></div>
          </dl>
          <div className="review-actions">
            <button type="button" onClick={() => setReview(null)} disabled={sending}>Cancel</button>
            <button type="button" onClick={submitReviewedAction} disabled={sending}>
              {sending ? "Waiting for wallet" : "Approve in wallet"}
            </button>
          </div>
        </div>
      )}

      {(error || signature) && (
        <div className={`transaction-result ${error ? "error" : "success"}`}>
          {error ? (
            <><strong>Transaction not sent</strong><span>{error}</span><button type="button" onClick={refresh}>Retry state</button></>
          ) : (
            <><strong>Transaction confirmed</strong><a href={explorerUrl(signature)} target="_blank" rel="noreferrer">View on Solana Explorer ↗</a></>
          )}
        </div>
      )}

      {leaders.length > 0 && (
        <div className="mini-leaderboard">
          <small>Indexed leaderboard</small>
          {leaders.map((leader) => (
            <span key={leader.wallet}>
              <b>#{leader.rank}</b>
              <code>{shortAddress(leader.wallet)}</code>
              <em>{leader.power} power · {leader.active_rigs} rigs</em>
            </span>
          ))}
        </div>
      )}

      <div className="transaction-note">
        Every action is signed in your wallet and settled by the Uranium Strategy program. This site never stores private keys or seed phrases.
      </div>
    </>
  );
}

function RuntimeContent(props: WalletIslandProps) {
  if (props.variant === "compact") {
    return <WalletControl compact />;
  }

  return <GamePanel contractConfigured={props.contractConfigured} />;
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
      <div className="console-toolbar">
        <div className="console-status">
          <span className="status-light" />
          <div>
            <small>Solana protocol / confirmed</small>
            <strong>Connect a Solana wallet to view your reserve</strong>
          </div>
        </div>
        <button className="panel-wallet-placeholder" type="button" disabled>
          Connect wallet
        </button>
      </div>
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
