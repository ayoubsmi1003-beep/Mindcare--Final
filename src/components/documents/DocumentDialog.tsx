"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/** The native top layer keeps confirmations outside clipped/translated app panels. */
export function DocumentDialog({ title, busy = false, onDismiss, children }: {
  readonly title: string;
  readonly busy?: boolean;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="doc2-confirm" aria-labelledby={titleId} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onDismiss(); }}>
    <h2 id={titleId}>{title}</h2>
    {children}
  </dialog>;
}
