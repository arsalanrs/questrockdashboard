"use client";

import { useEffect, useState } from "react";

export function MonitorLiveStrip() {
  const [clock, setClock] = useState("");
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    function tick() {
      const now = new Date();
      setClock(
        now.toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }) + " ET",
      );
    }
    tick();
    const clockId = setInterval(tick, 1000);
    const countId = setInterval(() => {
      setCountdown((c) => (c <= 0 ? 30 : c - 1));
    }, 1000);
    return () => {
      clearInterval(clockId);
      clearInterval(countId);
    };
  }, []);

  return (
    <div className="mon-live-strip">
      <span className="pulse-dot" aria-hidden />
      LIVE OPERATIONS MONITOR <span className="sep">·</span>
      <span className="mono">{clock || "—"}</span> <span className="sep">·</span>
      <span>
        auto-refresh in <span className="mono">{countdown}</span>s
      </span>
    </div>
  );
}
