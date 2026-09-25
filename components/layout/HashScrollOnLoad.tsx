"use client";

import { useEffect } from "react";

/** How long to keep waiting for a hash target that mounts after hydration. */
const WAIT_FOR_MOUNT_MS = 2500;

/**
 * Scrolls to `#id` from the initial URL. The browser's own jump can land
 * before client content has mounted or settled, so this retries until the
 * target exists. The header offset comes from the target's scroll-margin.
 */
export function HashScrollOnLoad() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;

    const attempt = () => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ behavior: "instant", block: "start" });
      return el != null;
    };
    if (attempt()) return;

    const observer = new MutationObserver(() => {
      if (attempt()) stop();
    });
    const timer = window.setTimeout(() => stop(), WAIT_FOR_MOUNT_MS);
    function stop() {
      observer.disconnect();
      window.clearTimeout(timer);
    }
    observer.observe(document.body, { childList: true, subtree: true });
    return stop;
  }, []);

  return null;
}
