import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function PageHeader({ eyebrow, title, actions, children }: {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-brand">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-bold">{title}</h1>
        {children && <div className="mt-1 text-sm text-slate-600">{children}</div>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const btn = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-slate-600 hover:bg-slate-100",
};
const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50";

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & {
  variant?: keyof typeof btn;
}) {
  return <button {...props} className={`${btnBase} ${btn[variant]} ${className}`} />;
}

export function ButtonLink({ variant = "primary", className = "", ...props }: ComponentProps<typeof Link> & {
  variant?: keyof typeof btn;
}) {
  return <Link {...props} className={`${btnBase} ${btn[variant]} ${className}`} />;
}

const inputCls =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-slate-50";

export function Field({ label, hint, error, className = "", ...props }: ComponentProps<"input"> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input {...props} className={inputCls} />
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Select({ label, children, className = "", ...props }: ComponentProps<"select"> & { label: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select {...props} className={inputCls}>
        {children}
      </select>
    </label>
  );
}

export function TextArea({ label, className = "", ...props }: ComponentProps<"textarea"> & { label: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <textarea {...props} className={inputCls} />
    </label>
  );
}

export function Checkbox({ label, ...props }: ComponentProps<"input"> & { label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" {...props} className="h-4 w-4 rounded border-slate-300 accent-brand" />
      {label}
    </label>
  );
}

const badgeTone = {
  gray: "bg-slate-100 text-slate-700",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
};

export function Badge({ tone = "gray", children }: { tone?: keyof typeof badgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeTone[tone]}`}>
      {children}
    </span>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty && <p className="px-4 py-8 text-center text-sm text-slate-500">{empty}</p>}
    </div>
  );
}

export const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) => (
  <td className={`whitespace-nowrap px-4 py-2.5 ${className}`}>{children}</td>
);

export function FormMessage({ state }: { state?: { error?: string; ok?: string } }) {
  if (state?.error) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state?.ok) return <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.ok}</p>;
  return null;
}
