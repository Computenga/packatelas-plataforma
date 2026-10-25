"use client";

// Escáner de etiquetas: cámara del teléfono o lector PDA que escribe como teclado [P06].
import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

type Mode = "camera" | "pda";

declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => {
      detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
    };
  }
}

/** Evita procesar dos veces la misma etiqueta mientras sigue frente a la cámara. */
const REPEAT_WINDOW_MS = 3000;

export function Scanner({ onScan, busy }: { onScan: (raw: string) => void; busy?: boolean }) {
  const [mode, setMode] = useState<Mode>("camera");
  const [cameraError, setCameraError] = useState<string>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const pdaRef = useRef<HTMLInputElement>(null);

  const emit = useCallback(
    (value: string) => {
      const v = value.trim();
      if (!v) return;
      const now = Date.now();
      if (v === lastRef.current.value && now - lastRef.current.at < REPEAT_WINDOW_MS) return;
      lastRef.current = { value: v, at: now };
      onScan(v);
    },
    [onScan],
  );

  // Cámara
  useEffect(() => {
    if (mode !== "camera") return;
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;
    const detector = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
        const video = videoRef.current;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play();
        setCameraError(undefined);

        const tick = async () => {
          if (stopped) return;
          const canvas = canvasRef.current;
          if (video.readyState >= 2 && canvas) {
            if (detector) {
              const codes = await detector.detect(video).catch(() => []);
              if (codes[0]) emit(codes[0].rawValue);
            } else {
              const w = video.videoWidth;
              const h = video.videoHeight;
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(video, 0, 0, w, h);
                const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
                if (code?.data) emit(code.data);
              }
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setCameraError("No se pudo abrir la cámara. Revisa el permiso del navegador o usa el modo PDA.");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [mode, emit]);

  // PDA: mantener el foco en el campo oculto para recibir las lecturas
  useEffect(() => {
    if (mode !== "pda") return;
    const focus = () => pdaRef.current?.focus();
    focus();
    const id = setInterval(() => {
      if (document.activeElement?.tagName !== "INPUT" || document.activeElement === pdaRef.current) focus();
    }, 1000);
    return () => clearInterval(id);
  }, [mode]);

  return (
    <div>
      <div className="mb-3 inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {(["camera", "pda"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 ${mode === m ? "bg-brand text-white" : "text-slate-600"}`}
          >
            {m === "camera" ? "Cámara" : "PDA / lector"}
          </button>
        ))}
      </div>

      {mode === "camera" ? (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className={`h-52 w-52 rounded-2xl border-4 ${busy ? "border-accent" : "border-white/80"}`} />
          </div>
          {cameraError && <p className="absolute inset-x-0 bottom-0 bg-red-600 p-3 text-sm text-white">{cameraError}</p>}
          <canvas ref={canvasRef} className="hidden" />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = pdaRef.current;
            if (!input) return;
            emit(input.value);
            input.value = "";
          }}
          className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-6 text-center"
        >
          <p className="font-medium">Modo lector activo</p>
          <p className="text-sm text-slate-500">Dispara el lector sobre la etiqueta. También puedes escribir el número y dar Enter.</p>
          <input
            ref={pdaRef}
            autoComplete="off"
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono"
            placeholder="Esperando lectura…"
          />
        </form>
      )}
    </div>
  );
}
