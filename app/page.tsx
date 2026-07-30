"use client";

import {
  Component,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import LiveChat from "./live-chat";
import WalletIsland from "./wallet-island";

const PROGRAM_ID = process.env.NEXT_PUBLIC_USR_PROGRAM_ID ?? "";
const USR_MINT = process.env.NEXT_PUBLIC_USR_MINT ?? "";
const USR_CONFIG = process.env.NEXT_PUBLIC_USR_CONFIG_PDA ?? "";
const USR_REWARD_VAULT = process.env.NEXT_PUBLIC_USR_REWARD_VAULT ?? "";
const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
const X_URL = process.env.NEXT_PUBLIC_X_URL ?? "";
const PUMP_FUN_URL = process.env.NEXT_PUBLIC_PUMP_FUN_URL ?? "";
const DEXSCREENER_URL = process.env.NEXT_PUBLIC_DEXSCREENER_URL ?? "";
const NETWORK_LABEL = CLUSTER === "mainnet-beta" ? "Mainnet" : "Devnet";

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

function FooterLink({ href, label }: { href: string; label: string }) {
  if (!href) {
    return <span className="market-link pending" aria-disabled="true">{label} · pending</span>;
  }

  return (
    <a className="market-link" href={href} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
  );
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

class GameErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Game panel recovered from an error", error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="game-error-fallback" role="alert">
          <strong>The game panel stopped safely.</strong>
          <span>Your wallet was not charged and no transaction was sent.</span>
          <button type="button" onClick={() => this.setState({ failed: false })}>
            Retry game
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function Home() {
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedCa, setCopiedCa] = useState(false);
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
    try {
      await navigator.clipboard.writeText(PROGRAM_ID);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const copyContractAddress = async () => {
    if (!USR_MINT) return;
    try {
      await navigator.clipboard.writeText(USR_MINT);
      setCopiedCa(true);
      window.setTimeout(() => setCopiedCa(false), 1800);
    } catch {
      setCopiedCa(false);
    }
  };

  return (
    <>
      <main className={`strategy-shell ${panel ? "panel-open" : ""}`}>
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
          <span className="live-badge"><i /> Solana · {NETWORK_LABEL}</span>
          <a className="about-button how-link" href="#how-it-works">How it works</a>
          <button className="about-button" type="button" onClick={() => setPanel("about")}>Protocol</button>
          {X_URL ? (
            <a className="top-link" href={X_URL} target="_blank" rel="noreferrer" aria-label="Uranium Strategy on X">X</a>
          ) : (
            <span className="top-link pending" title="Official X link pending">X</span>
          )}
          <button
            className="ca-button"
            type="button"
            disabled={!USR_MINT}
            onClick={copyContractAddress}
            aria-label={`Copy ${NETWORK_LABEL} USR contract address`}
          >
            <span>{copiedCa ? "Copied" : `${NETWORK_LABEL} CA`}</span>
            <strong>{USR_MINT ? shortAddress(USR_MINT) : "Pending"}</strong>
          </button>
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
              <div className="panel-kicker">Protocol console / Solana {NETWORK_LABEL.toLowerCase()}</div>
              <h2 id="panel-title">Build your<br /><span>reserve.</span></h2>
              <GameErrorBoundary>
                <ProtocolConsole />
              </GameErrorBoundary>
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

      <section className="how-section" id="how-it-works" aria-labelledby="how-title">
        <div className="section-heading">
          <span>Protocol loop / four moves</span>
          <h2 id="how-title">How it works.</h2>
          <p>Every balance, rig level and reward calculation settles through the Uranium Strategy program—not a private game server.</p>
        </div>
        <div className="how-grid">
          <article>
            <b>01</b>
            <small>Enter</small>
            <h3>Connect on Solana</h3>
            <p>Connect a Wallet Standard wallet. During beta, the interface is connected to Devnet and beta USR has no market value.</p>
          </article>
          <article>
            <b>02</b>
            <small>Build</small>
            <h3>Burn USR for rigs</h3>
            <p>Choose one of 25 cells and burn USR in 1,000-token increments. Each increment adds one permanent level and one unit of mining power.</p>
          </article>
          <article>
            <b>03</b>
            <small>Mine</small>
            <h3>Earn from a finite vault</h3>
            <p>Your share of the 64.4M USR reward reserve accrues by mining power. Base emissions halve every seven days and no new tokens can be minted.</p>
          </article>
          <article>
            <b>04</b>
            <small>Choose</small>
            <h3>Claim or compound</h3>
            <p>Claim rewards to your wallet with a 2% burn, or compound them into more power with a 0.75% burn. Your wallet approves every transaction.</p>
          </article>
        </div>
      </section>

      <LiveChat />

      <footer className="market-footer">
        <span>Uranium Strategy · Solana {NETWORK_LABEL}</span>
        <nav aria-label="Official market and social links">
          <FooterLink href={PUMP_FUN_URL} label="Pump.fun" />
          <FooterLink href={X_URL} label="X.com" />
          <FooterLink href={DEXSCREENER_URL} label="Dexscreener" />
        </nav>
        <small>Verify the contract address shown above. Market links remain disabled until their official URLs are configured.</small>
      </footer>
    </>
  );
}
