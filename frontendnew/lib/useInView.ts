"use client";

import { useEffect, useRef } from "react";

/**
 * Adds a class to the observed element the first time it enters the
 * viewport.
 *
 * The class is a parameter because the trigger has to be able to be
 * scoped. `.in .io` matches ANY ancestor carrying `.in`, so a block
 * nested inside an already-triggered section can never wait for its own
 * turn — and both of this page's sections are thousands of pixels tall,
 * so their own `.in` fires long before most of what they contain is on
 * screen. A block that wants its own timing observes itself under its
 * own class name.
 */
export function useInView<T extends HTMLElement>(threshold: number, cls = "in") {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add(cls);
            io.unobserve(e.target);
          }
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, cls]);
  return ref;
}
