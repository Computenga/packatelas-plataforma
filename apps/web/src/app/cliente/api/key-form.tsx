"use client";
import { useActionState, useState } from "react";
import { Button, Field } from "@/components/ui";
import { createKeyAction } from "./actions";

export function KeyForm() {
  const [state, action, pending] = useActionState(createKeyAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <Field name="name" label="Nombre de la llave" placeholder="Ej. Tienda en línea" maxLength={60} className="min-w-56 flex-1" />
        <Button disabled={pending}>{pending ? "Creando…" : "Crear llave"}</Button>
      </form>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.key && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Copia tu llave ahora: no se volverá a mostrar.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 font-mono text-xs">{state.key}</code>
            <button type="button" className="text-brand hover:underline" onClick={() => { void navigator.clipboard.writeText(state.key!); setCopied(true); }}>
              {copied ? "Copiada" : "Copiar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Secret({ value }: { value: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-xs">{show ? value : `${value.slice(0, 9)}••••••••••••`}</code>
      <button type="button" className="text-sm text-brand hover:underline" onClick={() => setShow(!show)}>{show ? "Ocultar" : "Mostrar"}</button>
    </span>
  );
}
