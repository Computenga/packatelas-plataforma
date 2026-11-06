/** Imprime la página: en la app Android (1.7+) abre el diálogo de impresión del teléfono; si no, el del navegador. */
export function printPage() {
  const native = (window as unknown as { PackatelasNative?: { print?: (title: string) => void } }).PackatelasNative;
  if (native && typeof native.print === "function") native.print(document.title);
  else window.print();
}
