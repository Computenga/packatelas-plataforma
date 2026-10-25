"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { FormMessage } from "./ui";

export type ActionState = { error?: string; ok?: string };
type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Formulario con mensaje de éxito/error y botón deshabilitado mientras envía. */
export function ActionForm({ action, children, submitLabel, className = "", resetOnSuccess = false }: {
  action: Action;
  children: ReactNode;
  submitLabel: string;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={`space-y-4 ${className}`}>
      {children}
      <FormMessage state={state} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
      >
        {pending ? "Guardando…" : submitLabel}
      </button>
    </form>
  );
}
