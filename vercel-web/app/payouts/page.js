"use client";

import dynamic from "next/dynamic";

var PayoutsInner = dynamic(
  function () {
    return import("./payouts-inner");
  },
  {
    ssr: false,
    loading: function () {
      return (
        <div className="page-grid">
          <p className="mini-muted" style={{ padding: "2rem 1rem" }}>
            Loading payouts…
          </p>
        </div>
      );
    }
  }
);

export default function PayoutsPage() {
  return <PayoutsInner />;
}
