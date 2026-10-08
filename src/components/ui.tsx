"use client";
import { useRef, useState, useTransition } from "react";
import { AlertCircle, LoaderCircle, X, type LucideIcon } from "lucide-react";
import type { ActionResult } from "@/lib/domain";

export function ErrorMessage({ children }: { children: React.ReactNode }) {
  return <div className="error-message" role="alert"><AlertCircle size={18}/><span>{children}</span></div>;
}
export function Spinner() { return <LoaderCircle size={18} className="spin" aria-hidden="true"/>; }
export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={34} strokeWidth={1.5}/></span><h2>{title}</h2><p>{children}</p>{action}</div>;
}
export function ConfirmDialog({ trigger, title, children, confirmLabel, onConfirm, destructive = false, onSuccess, disabled = false }: {
  trigger: React.ReactNode; title: string; children: React.ReactNode; confirmLabel: string;
  onConfirm: () => Promise<ActionResult>; destructive?: boolean; onSuccess?: () => void; disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return <><button type="button" className={destructive ? "button button-danger-quiet" : "button button-primary"} disabled={disabled} onClick={() => { setError(""); dialog.current?.showModal(); }}>{trigger}</button>
    <dialog ref={dialog} className="confirm-dialog" aria-label={title} onCancel={event => { if (pending) event.preventDefault(); }}>
      <button type="button" className="icon-button modal-close" aria-label="Fermer" disabled={pending} onClick={() => dialog.current?.close()}><X size={20}/></button>
      <h2>{title}</h2><p>{children}</p>{error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" disabled={pending} onClick={() => dialog.current?.close()}>Annuler</button><button type="button" className={`button ${destructive ? "button-danger" : "button-primary"}`} disabled={pending} onClick={() => startTransition(async () => { try { const result = await onConfirm(); if (!result.ok) setError(result.error); else { dialog.current?.close(); onSuccess?.(); } } catch { setError("L’action a échoué. Vérifiez votre connexion puis réessayez."); } })}>{pending && <Spinner/>}{confirmLabel}</button></div>
    </dialog></>;
}
