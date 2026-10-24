import { Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type WakeLockStatus = "off" | "pending" | "active" | "paused" | "error";

export function wakeLockSupported() {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

/**
 * Hold a screen wake lock while `enabled`, re-acquiring it when the page
 * becomes visible again. Calls `onError` (once per failure) if denied.
 */
export function useWakeLock(enabled: boolean, onError?: () => void) {
  const supported = wakeLockSupported();
  const [status, setStatus] = useState<WakeLockStatus>("off");
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled || !supported) return;
    let disposed = false;
    let pending = false;
    let lock: WakeLockSentinel | undefined;

    const acquire = async () => {
      if (
        disposed ||
        pending ||
        (lock && !lock.released) ||
        document.visibilityState !== "visible"
      )
        return;
      pending = true;
      setStatus("pending");
      try {
        const acquired = await navigator.wakeLock.request("screen");
        if (disposed) {
          await acquired.release();
          return;
        }
        lock = acquired;
        setStatus(acquired.released ? "paused" : "active");
        acquired.addEventListener("release", () => {
          if (!disposed) setStatus("paused");
        });
      } catch {
        if (!disposed) {
          setStatus("error");
          onErrorRef.current?.();
        }
      } finally {
        pending = false;
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, [enabled, supported]);

  return { supported, status, setStatus };
}

export function KeepAwake() {
  const [enabled, setEnabled] = useState(false);
  const { supported, status, setStatus } = useWakeLock(enabled, () =>
    setEnabled(false),
  );

  return (
    <>
      <button
        type="button"
        className="organise-action keep-awake"
        disabled={!supported}
        aria-pressed={enabled}
        aria-describedby="keep-awake-status"
        title={
          !supported
            ? "Keep awake isn't available in this browser"
            : status === "error"
              ? "Couldn't keep the screen awake. Try again."
              : enabled
                ? "Turn keep awake off"
                : "Keep screen awake"
        }
        onClick={() => {
          setStatus("off");
          setEnabled(!enabled);
        }}
      >
        <Sun size={17} aria-hidden="true" />
        {status === "active"
          ? "Screen awake"
          : status === "pending"
            ? "Turning on…"
            : status === "paused"
              ? "Awake paused"
              : status === "error"
                ? "Retry keep awake"
                : "Keep awake"}
      </button>
      <span id="keep-awake-status" className="sr-only" role="status">
        {!supported
          ? "Keep awake isn't available in this browser."
          : status === "active"
            ? "Screen will stay awake while you cook."
            : status === "pending"
              ? "Turning keep awake on…"
              : status === "paused"
                ? "Keep awake paused. It will retry when you return to this page."
                : status === "error"
                  ? "Couldn't keep the screen awake. Check your battery settings and try again."
                  : "Keep your screen on while this recipe is open."}
      </span>
    </>
  );
}
