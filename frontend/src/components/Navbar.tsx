import { Link, useLocation } from "react-router-dom";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";

function Navbar() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { pathname } = useLocation();

  const links = [
    { to: "/", label: "Open Account" },
    { to: "/credit-score", label: "My Account" },
    { to: "/deposit", label: "Deposit / Withdraw" },
    { to: "/transfer", label: "Transfer" },
    { to: "/apply-loan", label: "Apply Loan" },
    { to: "/repay", label: "Repay Loan" },
    { to: "/admin-panel", label: "Scoring Policy" },
  ];

  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 32px",
        borderBottom: "1px solid #1e2d4a",
        background: "#0a0f1e",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}
    >
      <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
        <span
          style={{
            fontFamily: "JetBrains Mono, monospace",
            color: "#3b82f6",
            fontSize: "18px",
            marginRight: "16px",
            letterSpacing: "2px",
          }}
        >
          🔒 CONFBANK
        </span>
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            style={{
              color: pathname === link.to ? "#3b82f6" : "#64748b",
              textDecoration: "none",
              fontSize: "14px",
              fontWeight: 600,
              letterSpacing: "1px",
              textTransform: "uppercase",
              borderBottom: pathname === link.to ? "2px solid #3b82f6" : "2px solid transparent",
              paddingBottom: "2px",
            }}
          >
            {link.label}
          </Link>
        ))}
      </div>
      <div>
        {isConnected ? (
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "13px", color: "#64748b" }}>
              {address?.slice(0, 6)}...{address?.slice(-4)}
            </span>
            <button onClick={() => disconnect()}>Disconnect</button>
          </div>
        ) : (
          <button onClick={() => connect({ connector: injected() })}>Connect Wallet</button>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
