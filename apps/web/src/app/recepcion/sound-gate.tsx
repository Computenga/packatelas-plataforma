"use client";

import { useState } from "react";
import { audioReady, unlockAudio } from "@/lib/beep";

/** iOS solo deja sonar el zumbido después de un toque: un botón grande al empezar. */
export function SoundGate() {
  const [on, setOn] = useState(audioReady);
  if (on) return null;
  return (
    <button
      type="button"
      onClick={() => setOn(unlockAudio())}
      className="mb-4 w-full rounded-xl bg-amber-400 px-4 py-4 text-lg font-bold text-slate-900"
    >
      🔈 Toca aquí para activar el sonido de alertas
    </button>
  );
}
