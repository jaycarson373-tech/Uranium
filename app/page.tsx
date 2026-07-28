"use client";

import { useEffect, useMemo, useState } from "react";
import WalletIsland from "./wallet-island";

const PROGRAM_ID = process.env.NEXT_PUBLIC_USR_PROGRAM_ID ?? "";
const USR_MINT = process.env.NEXT_PUBLIC_USR_MINT ?? "";
const USR_CONFIG = process.env.NEXT_PUBLIC_USR_CONFIG_PDA ?? "";
const USR_REWARD_VAULT = process.env.NEXT_PUBLIC_USR_REWARD_VAULT ?? "";

const stats = [
  ["92M", "fixed max supply"],
  ["25", "on-chain grid cells"],
  ["2%", "claim burn"],
  ["0.75%", "compound fee"],
];

type Panel = "about" | "console" | null;

function shortAddress(value: string) {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function ProtocolConsole() {
  const contractConfigured = Boolean(
    PROGRAM_ID && USR_MINT && USR_CONFIG && USR_REWARD_VAULT,
  );

  return (
    <div className="protocol-console">
      <WalletIsland variant="panel" contractConfigured={contractConfigured} />
    </div>
  );
}

export default function Home() {
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const reserveLabel = useMemo(
    () => PROGRAM_ID ? shortAddress(PROGRAM_ID) : "Program unavailable",
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
          <span className="live-badge"><i /> Solana · Beta</span>
          <button className="about-button" type="button" onClick={() => setPanel("about")}>Protocol</button>
          <WalletIsland variant="compact" />
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
            Open Protocol Console
            <span aria-hidden="true">→</span>
          </button>
          <span className="deploy-hint">Wallet-native strategy · verifiable on-chain</span>
          <button className="reserve-id" type="button" disabled={!PROGRAM_ID} onClick={copyProgramId} aria-label="Copy Uranium Strategy program ID">
            <span>PROGRAM</span><strong>{copied ? "Copied to clipboard" : reserveLabel}</strong>
            <span aria-hidden="true">{copied ? "✓" : PROGRAM_ID ? "⧉" : "○"}</span>
          </button>
        </div>
      </section>

      <section className="stats" aria-label="Protocol statistics">
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
              <div className="panel-kicker">Protocol console / Solana beta</div>
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
                <strong>Future RWA expansion:</strong> a separate regulated adapter could route part of protocol revenue toward eligible uranium-linked assets. It remains outside the core token contract.
              </div>
              <button className="panel-cta" type="button" onClick={() => setPanel("console")}>Open protocol console <span aria-hidden="true">→</span></button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
