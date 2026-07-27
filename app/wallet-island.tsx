"use client";

import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";

export type WalletIslandProps = {
  variant: "compact" | "panel";
  contractConfigured?: boolean;
};

const WalletRuntime = lazy(() => import("./wallet-runtime"));

function WalletPlaceholder({
  variant,
  contractConfigured = true,
  unavailable = false,
}: WalletIslandProps & { unavailable?: boolean }) {
  if (variant === "compact") {
    return (
      <button className="wallet-button compact" type="button" disabled>
        {unavailable ? "Wallet unavailable" : "Connect wallet"}
      </button>
    );
  }

  return (
    <>
      <div className="console-status">
        <span className="status-light" />
        <div>
          <small>Solana protocol / beta</small>
          <strong>
            {!contractConfigured
              ? "Protocol configuration unavailable"
              : unavailable
                ? "Wallet unavailable · reload is not required"
                : "Connect a Solana wallet to view your reserve"}
          </strong>
        </div>
      </div>
      <button className="panel-wallet-placeholder" type="button" disabled>
        {unavailable ? "Wallet unavailable" : "Connect wallet"}
      </button>
    </>
  );
}

class WalletErrorBoundary extends Component<
  WalletIslandProps & { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Wallet integration failed safely", error, info);
  }

  render() {
    if (this.state.failed) {
      return <WalletPlaceholder {...this.props} unavailable />;
    }

    return this.props.children;
  }
}

export default function WalletIsland(props: WalletIslandProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <WalletPlaceholder {...props} />;
  }

  return (
    <WalletErrorBoundary {...props}>
      <Suspense fallback={<WalletPlaceholder {...props} />}>
        <WalletRuntime {...props} />
      </Suspense>
    </WalletErrorBoundary>
  );
}
