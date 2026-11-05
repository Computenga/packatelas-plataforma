"use client";

// Sonidos de recepción. En iPad no hay vibración: la alerta es un zumbido fuerte.
// iOS solo deja sonar audio después de un toque: llamar `unlockAudio()` en un botón.
let ctx: AudioContext | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

export function unlockAudio() {
  const c = audio();
  if (!c) return false;
  void c.resume();
  tone(c, 880, 0.05, "sine", 0.01);
  return true;
}

export const audioReady = () => ctx?.state === "running";

function tone(c: AudioContext, freq: number, secs: number, type: OscillatorType, vol = 0.4, start = 0) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = vol;
  o.connect(g).connect(c.destination);
  const t = c.currentTime + start;
  o.start(t);
  o.stop(t + secs);
}

/** Lectura correcta: bip corto. */
export function beepOk() {
  const c = audio();
  if (c) tone(c, 1320, 0.09, "sine", 0.3);
}

/** No cuadra: zumbido grave tres veces. */
export function buzz() {
  const c = audio();
  if (!c) return;
  for (let i = 0; i < 3; i++) tone(c, 140, 0.32, "sawtooth", 0.6, i * 0.42);
}
