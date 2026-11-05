"use client";

// Firma con el dedo o lápiz (iPad). Devuelve un PNG en data URL.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export type SignatureHandle = { toDataUrl: () => string | null; clear: () => void };

export const SignaturePad = forwardRef<SignatureHandle, { onChange?: (empty: boolean) => void; className?: string }>(function SignaturePad({ onChange, className }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  const setup = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.lineWidth = 2.6;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#0f172a";
  }, []);

  useEffect(() => {
    setup();
  }, [setup]);

  const mark = (e: boolean) => {
    setEmpty(e);
    onChange?.(e);
  };

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  useImperativeHandle(ref, () => ({
    toDataUrl: () => (empty ? null : (canvas.current?.toDataURL("image/png") ?? null)),
    clear: () => {
      setup();
      mark(true);
    },
  }));

  return (
    <div className={className}>
      <canvas
        ref={canvas}
        className="h-full w-full touch-none rounded-xl border-2 border-dashed border-slate-300 bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = pos(e);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const g = e.currentTarget.getContext("2d")!;
          const p = pos(e);
          g.beginPath();
          g.moveTo(last.current.x, last.current.y);
          g.lineTo(p.x, p.y);
          g.stroke();
          last.current = p;
          if (empty) mark(false);
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
    </div>
  );
});
