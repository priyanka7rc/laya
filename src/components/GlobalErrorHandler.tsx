"use client";

import { useEffect } from "react";

function postToLog(payload: {
  level: "error" | "warn";
  message: string;
  stack?: string;
  url?: string;
}) {
  try {
    navigator.sendBeacon(
      "/api/log",
      new Blob([JSON.stringify(payload)], { type: "application/json" })
    );
  } catch {
    // sendBeacon not available — fall back to fetch (best-effort)
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }
}

export default function GlobalErrorHandler() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      postToLog({
        level: "error",
        message: event.message || "Unknown error",
        stack: event.error?.stack,
        url: window.location.href,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Unhandled promise rejection";
      postToLog({
        level: "error",
        message,
        stack: reason instanceof Error ? reason.stack : undefined,
        url: window.location.href,
      });
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}
