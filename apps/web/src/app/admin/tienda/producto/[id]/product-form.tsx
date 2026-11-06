"use client";

import { useActionState, useRef, useState } from "react";
import type { ProductState } from "../../product-actions";

type Initial = { name: string; category: string; price: string; salePrice: string; sku: string; stock: string; description: string; images: string[]; active: boolean };

/** Reduce la foto (lado mayor 1600 px) sobre fondo blanco, para que los PNG transparentes no queden negros. */
async function shrink(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

export function ProductForm({ action, initial, categories }: { action: (prev: ProductState, fd: FormData) => Promise<ProductState>; initial: Initial; categories: string[] }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [keep, setKeep] = useState(initial.images);
  const [added, setAdded] = useState<{ file: File; url: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2";

  const onFiles = async (list: FileList | null) => {
    if (!list) return;
    const out: { file: File; url: string }[] = [];
    for (const f of Array.from(list).slice(0, 10)) {
      const small = await shrink(f);
      out.push({ file: small, url: URL.createObjectURL(small) });
    }
    setAdded((a) => [...a, ...out].slice(0, 10 - keep.length));
    if (fileRef.current) fileRef.current.value = "";
  };
  const submit = (fd: FormData) => {
    fd.delete("photos");
    for (const a of added) fd.append("photos", a.file);
    for (const k of keep) fd.append("keep", k);
    return formAction(fd);
  };

  return (
    <form action={submit} className="space-y-4 text-sm">
      <label className="block font-medium">Título
        <input name="name" required minLength={3} maxLength={200} defaultValue={initial.name} className={field} />
      </label>

      <div>
        <p className="font-medium">Fotos <span className="font-normal text-slate-500">(la primera es la portada; máximo 10)</span></p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {keep.map((k, i) => (
            <li key={k} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/tienda/foto/${k}`} alt="" className="h-24 w-24 rounded-lg border border-slate-200 object-contain" />
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-white/90 text-xs">
                {i > 0 ? <button type="button" onClick={() => setKeep((x) => [x[i], ...x.filter((_, j) => j !== i)])} className="px-1 text-brand">Portada</button> : <span className="px-1 text-slate-500">Portada</span>}
                <button type="button" onClick={() => setKeep((x) => x.filter((_, j) => j !== i))} className="px-1 text-red-600">Quitar</button>
              </div>
            </li>
          ))}
          {added.map((a, i) => (
            <li key={a.url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt="" className="h-24 w-24 rounded-lg border border-dashed border-brand object-contain" />
              <button type="button" onClick={() => setAdded((x) => x.filter((_, j) => j !== i))} className="absolute inset-x-0 bottom-0 bg-white/90 text-xs text-red-600">Quitar</button>
            </li>
          ))}
          {keep.length + added.length < 10 && (
            <li>
              <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-center text-xs text-slate-500 hover:border-brand">
                + Agregar fotos
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => void onFiles(e.target.files)} className="sr-only" />
              </label>
            </li>
          )}
        </ul>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block font-medium">Precio normal ($)
          <input name="price" required inputMode="decimal" defaultValue={initial.price} className={`${field} tabular-nums`} />
        </label>
        <label className="block font-medium">Precio de oferta ($) <span className="font-normal text-slate-500">opcional</span>
          <input name="salePrice" inputMode="decimal" defaultValue={initial.salePrice} placeholder="Sin oferta" className={`${field} tabular-nums`} />
        </label>
        <label className="block font-medium">SKU <span className="font-normal text-slate-500">opcional</span>
          <input name="sku" maxLength={60} defaultValue={initial.sku} className={`${field} font-mono`} />
        </label>
        <label className="block font-medium">Stock (piezas disponibles)
          <input name="stock" required inputMode="numeric" pattern="\d+" defaultValue={initial.stock} className={`${field} tabular-nums`} />
        </label>
      </div>

      <label className="block font-medium">Categoría <span className="font-normal text-slate-500">para agrupar en la tienda</span>
        <input name="category" list="categorias" maxLength={80} defaultValue={initial.category} placeholder="Insumos" className={field} />
        <datalist id="categorias">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </label>

      <label className="block font-medium">Descripción
        <textarea name="description" rows={5} maxLength={2000} defaultValue={initial.description} className={field} />
      </label>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="active" defaultChecked={initial.active} className="accent-brand" /> Visible para las tiendas
      </label>

      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{state.error}</p>}
      <button disabled={pending} className="rounded-lg bg-brand px-5 py-2.5 font-semibold text-white disabled:opacity-50">{pending ? "Guardando…" : "Guardar producto"}</button>
    </form>
  );
}
