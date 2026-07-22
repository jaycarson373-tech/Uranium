"use client";

import {
  WalletReadyGate,
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import { useEffect, useMemo, useState } from "react";

const PROGRAM_ID = process.env.NEXT_PUBLIC_USR_PROGRAM_ID ?? "";
const USR_MINT = process.env.NEXT_PUBLIC_USR_MINT ?? "";
const GRID = Array.from({ length: 25 }, (_, index) => index);

const stats = [
  ["92M", "proposed max supply"],
  ["25", "on-chain grid cells"],
  ["2%", "claim burn"],
  ["0.75%", "compound fee"],
];

type Panel = "about" | "console" | null;

function shortAddress(value: string) {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function WalletControl({ compact = false }: { compact?: boolean }) {
  const wallets = useWallets();
  const connected = useConnectedWallet();
  const { dispatch: connect, isRunning: connecting } = useConnect();
  const { dispatch: disconnect, isRunning: disconnecting } = useDisconnect();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (connected) {
    return (
      <button
        className={`wallet-button connected ${compact ? "compact" : ""}`}
        type="button"
        disabled={disconnecting}
        onClick={() => disconnect()}
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
        onClick={() => wallets.length === 1 ? connect(wallets[0]) : setPickerOpen((value) => !value)}
      >
        <span className="wallet-glyph" aria-hidden="true">▰</span>
        {connecting ? "Connecting" : "Connect wallet"}
      </button>
      {pickerOpen && (
        <div className="wallet-menu" role="menu">
          {wallets.map((wallet) => (
            <button key={wallet.name} type="button" role="menuitem" onClick={() => {
              setPickerOpen(false);
              connect(wallet);
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

function ProtocolConsole() {
  const connected = useConnectedWallet();
  const [selectedSlot, setSelectedSlot] = useState(12);
  const contractConfigured = Boolean(PROGRAM_ID && USR_MINT);
  const stateLabel = !connected
    ? "Connect a Solana wallet to prepare your miner account"
    : !contractConfigured
      ? "Program tested locally · devnet deployment approval required"
      : "Devnet configuration detected · instruction client pending activation";

  return (
    <div className="protocol-console">
      <div className="console-status">
        <span className={`status-light ${connected ? "ready" : ""}`} />
        <div>
          <small>Solana devnet / pre-launch</small>
          <strong>{stateLabel}</strong>
        </div>
      </div>

      <div className="console-layout">
        <div className="reserve-map">
          <div className="map-heading">
            <span>Your reserve / 5 × 5</span>
            <span>Slot {selectedSlot + 1}</span>
          </div>
          <div className="reserve-grid" aria-label="Reserve grid">
            {GRID.map((slot) => (
              <button
                key={slot}
                className={slot === selectedSlot ? "selected" : ""}
                type="button"
                aria-label={`Select reserve slot ${slot + 1}`}
                aria-pressed={slot === selectedSlot}
                onClick={() => setSelectedSlot(slot)}
              >
                {slot === selectedSlot ? "☢" : String(slot + 1).padStart(2, "0")}
              </button>
            ))}
          </div>
        </div>

        <div className="console-controls">
          <div className="control-card">
            <small>Selected cell</small>
            <strong>Uranium Rig #{selectedSlot + 1}</strong>
            <p>Burn USR to add permanent mining power to this wallet-owned on-chain cell.</p>
            <label>
              Build amount
              <span><input value="1,000" readOnly aria-label="Build amount" /> USR</span>
            </label>
            <button type="button" disabled>Deploy after devnet approval</button>
          </div>
          <div className="action-row">
            <button type="button" disabled><small>Net to wallet</small>Claim rewards</button>
            <button type="button" disabled><small>Burn + add power</small>Compound</button>
          </div>
        </div>
      </div>

      <div className="transaction-note">
        No transaction will be created until the program ID and USR mint are deployed and shown for approval. No private key is stored by this site.
      </div>
      <WalletReadyGate fallback={<button className="panel-wallet-placeholder" disabled>Checking wallets…</button>}>
        <WalletControl />
      </WalletReadyGate>
    </div>
  );
}

export default function Home() {
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const reserveLabel = useMemo(
    () => PROGRAM_ID ? shortAddress(PROGRAM_ID) : "Devnet deploy pending",
    [],
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const copyProgramId = async () => {
    if (!PROGRAM_ID) return;
    await navigator.clipboard.writeText(PROGRAM_ID);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <main className="strategy-shell">
      <div className="scene" aria-hidden="true">
        <div className="scene-sky" />
        <div className="radiation-haze" />
        <div className="distant-ridge" />
        <div className="terrain">
          <div className="terrain-grid" />
          <div className="ore-pile ore-pile-a" />
          <div className="ore-pile ore-pile-b" />
          <div className="rail-line rail-line-a" />
          <div className="rail-line rail-line-b" />
        </div>
        <div className="mine-tower tower-left"><i /><i /><i /><i /></div>
        <div className="mine-tower tower-right"><i /><i /><i /><i /></div>
        <div className="reactor-vessel"><span>92</span></div>
        <div className="conveyor"><b /><b /><b /><b /><b /><b /><b /></div>
        <div className="signal-beam" />
        {Array.from({ length: 18 }).map((_, index) => (
          <span className={`particle particle-${index + 1}`} key={index} />
        ))}
        <div className="scene-wash" />
        <div className="vignette" />
      </div>

      <header className="topbar">
        <button className="brand" type="button" onClick={() => setPanel("about")} aria-label="About Uranium Strategy">
          <span className="brand-mark" aria-hidden="true">☢</span>
          <span className="brand-type"><strong>USR</strong><small>Uranium Strategy</small></span>
        </button>

        <nav className="top-actions" aria-label="Primary navigation">
          <button className="icon-button" type="button" aria-label={muted ? "Enable sound effects" : "Mute sound effects"} aria-pressed={muted} onClick={() => setMuted((value) => !value)}>
            <span aria-hidden="true">{muted ? "×" : "♪"}</span>
          </button>
          <span className="live-badge"><i /> Solana · Devnet</span>
          <button className="about-button" type="button" onClick={() => setPanel("about")}>Protocol</button>
          <WalletReadyGate fallback={<button className="wallet-button compact" disabled>Checking…</button>}>
            <WalletControl compact />
          </WalletReadyGate>
        </nav>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="eyebrow">Build · Burn · Compound</div>
        <h1 id="hero-title">The on-chain<br /><span>uranium empire.</span></h1>
        <p>
          Burn USR to build a 25-cell reserve. Mining power earns from a finite, auditable vault with deterministic halvings on Solana.
        </p>
        <div className="hero-actions">
          <button className="hero-button" type="button" onClick={() => setPanel("console")}>
            <span className="button-sweep" aria-hidden="true" />
            <span aria-hidden="true">☢</span>
            Open Devnet Console
            <span aria-hidden="true">→</span>
          </button>
          <span className="deploy-hint">Real wallet connection · contract deployment gated</span>
          <button className="reserve-id" type="button" disabled={!PROGRAM_ID} onClick={copyProgramId} aria-label="Copy Uranium Strategy program ID">
            <span>PROGRAM</span><strong>{copied ? "Copied to clipboard" : reserveLabel}</strong>
            <span aria-hidden="true">{copied ? "✓" : PROGRAM_ID ? "⧉" : "○"}</span>
          </button>
        </div>
      </section>

      <section className="stats" aria-label="Proposed protocol statistics">
        {stats.map(([value, label]) => (
          <div className="stat-card" key={label}><strong>{value}</strong><span>{label}</span></div>
        ))}
      </section>

      <div className={`about-overlay ${panel ? "open" : ""}`} aria-hidden={!panel} onMouseDown={(event) => {
        if (event.currentTarget === event.target) setPanel(null);
      }}>
        <section className={`about-panel ${panel === "console" ? "console-panel" : ""}`} role="dialog" aria-modal="true" aria-labelledby="panel-title">
          <button className="close-button" type="button" onClick={() => setPanel(null)} aria-label="Close panel">×</button>
          {panel === "console" ? (
            <>
              <div className="panel-kicker">Protocol console / devnet</div>
              <h2 id="panel-title">Build your<br /><span>reserve.</span></h2>
              <ProtocolConsole />
            </>
          ) : (
            <>
              <div className="panel-kicker">Protocol briefing / v1</div>
              <h2 id="panel-title">Burn to build.<br /><span>Mine the reserve.</span></h2>
              <p className="about-lead">
                Uranium Strategy is a Solana strategy game. A classic fixed-supply SPL token powers a personal 5 × 5 reserve stored in a wallet-owned program account.
              </p>
              <p>
                Building burns USR permanently. Each cell adds mining power; the protocol distributes a finite pre-funded reward vault pro rata, with deterministic halvings. Mint and freeze authority must be revoked before initialization.
              </p>
              <div className="node-grid">
                <article>
                  <span className="node-index">01 / Token sink</span>
                  <h3>Build Rigs</h3>
                  <p>Burn USR into any of 25 cells. Levels and power live in your miner PDA—not in a private database.</p>
                </article>
                <article>
                  <span className="node-index">02 / Finite emissions</span>
                  <h3>Claim or Compound</h3>
                  <p>Claim to your wallet with a 2% burn, or compound at 0.75% to add power without creating new supply.</p>
                </article>
              </div>
              <div className="phase-note">
                <strong>Phase 2, not day one:</strong> a separate regulated RWA adapter could route part of protocol revenue toward eligible uranium-linked assets. It is intentionally outside the core token contract.
              </div>
              <button className="panel-cta" type="button" onClick={() => setPanel("console")}>Open devnet console <span aria-hidden="true">→</span></button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
