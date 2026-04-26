import { useEffect, useRef } from "react";

/**
 * Run `fn` on `intervalMs` while the tab is visible. Pauses when the tab is
 * hidden (Page Visibility API) and re-fires immediately on return so the user
 * doesn't see stale data.
 *
 * Use this instead of a raw `setInterval` for any chain-data poller — saves
 * the dashboard from hammering the JSON-RPC proxy on background tabs.
 */
export function usePagePolling(fn: () => void, intervalMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;

    const start = () => {
      if (cancelled || timer !== undefined) return;
      timer = window.setInterval(() => fnRef.current(), intervalMs);
    };
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Tab just became visible — fire once immediately, then resume.
        fnRef.current();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}
