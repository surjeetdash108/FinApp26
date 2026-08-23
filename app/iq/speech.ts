"use client";

import { useEffect, useState } from "react";

/**
 * Voice selection for the transcript "Read aloud" narration.
 *
 * Web Speech ships wildly uneven voices, and the platform default is usually
 * the WORST one installed — a legacy formant synth (macOS "Fred", Windows
 * "Microsoft David Desktop", eSpeak on Linux). That default is what makes the
 * narration sound computerised. Modern systems also ship neural voices, but the
 * API never picks them for you: an utterance with no `voice` set always gets the
 * platform default. So we score what is actually installed and take the best
 * English one.
 *
 * Quality signals, in rough order of reliability:
 *   - `localService === false` — the voice is synthesised server-side. In
 *     practice every network voice on offer (Google's, Microsoft's "Online")
 *     is neural, while the robotic ones are all local.
 *   - Vendor quality tags in the name: Natural / Neural / Online / Premium /
 *     Enhanced. Microsoft and Apple both label their good voices this way.
 *   - Known-good voice names, for platforms that tag nothing.
 */

/** Name fragments that mark a higher-quality voice, with their score weight. */
const VOICE_BONUS: Array<[RegExp, number]> = [
  [/\bnatural\b/i, 60],
  [/\bneural\b/i, 60],
  [/\b(premium|enhanced)\b/i, 45],
  [/\bonline\b/i, 40],
  [/\bgoogle\b/i, 35],
  [/\bsiri\b/i, 35],
  [/\b(ava|samantha|allison|serena|jenny|aria|emma|nova|zoe|evelyn|nathan)\b/i, 20],
];

/**
 * Novelty and legacy formant voices. macOS installs a pile of joke voices
 * ("Zarvox", "Bubbles") that are valid `en-US` and would otherwise score as
 * plausible; "Fred"/"Albert"/eSpeak are the genuinely robotic ones. None are
 * acceptable for narration, so they are excluded outright rather than ranked.
 */
const VOICE_DENY =
  /\b(albert|bad news|good news|bahh|bells|boing|bubbles|cellos|deranged|fred|hysterical|jester|junior|kathy|organ|princess|ralph|superstar|trinoids|whisper|wobble|zarvox|espeak|pipsqueak|grandma|grandpa|rocko|shelley|sandy|eddy|flo|reed|rishi)\b/i;

function scoreVoice(v: SpeechSynthesisVoice): number {
  let s = 0;
  for (const [re, pts] of VOICE_BONUS) if (re.test(v.name)) s += pts;
  if (!v.localService) s += 30;
  if (/^en[-_]US/i.test(v.lang)) s += 10;
  else if (/^en[-_]GB/i.test(v.lang)) s += 5;
  if (v.default) s += 2;
  return s;
}

/**
 * Best available English narration voice, or null when the browser exposes
 * none worth using (callers then fall back to the platform default).
 */
export function pickNarrationVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const usable = voices.filter(
    (v) => /^en([-_]|$)/i.test(v.lang) && !VOICE_DENY.test(v.name),
  );
  if (!usable.length) return null;
  // Stable: sort a copy, and break score ties by name so the pick does not
  // change between reloads just because the platform reordered getVoices().
  return usable
    .slice()
    .sort((a, b) => scoreVoice(b) - scoreVoice(a) || a.name.localeCompare(b.name))[0];
}

/**
 * The chosen narration voice, once the browser has loaded its voice list.
 *
 * Chrome populates `getVoices()` asynchronously and returns an empty array on
 * the first call, so we also listen for `voiceschanged` — without that, Chrome
 * users silently keep the robotic default.
 */
export function useNarrationVoice(enabled: boolean): SpeechSynthesisVoice | null {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const load = () => {
      const picked = pickNarrationVoice(synth.getVoices());
      if (picked) setVoice(picked);
    };
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, [enabled]);

  return voice;
}

/**
 * Applies the narration voice and prosody to an utterance.
 *
 * Rate is nudged just below 1.0: neural voices read dense financial prose a
 * touch fast, and the small slowdown is what makes a long transcript sound
 * paced rather than rattled off. Pitch stays at the voice's natural 1.0 —
 * moving it is exactly what makes TTS sound synthetic.
 */
export function applyNarrationVoice(
  u: SpeechSynthesisUtterance,
  voice: SpeechSynthesisVoice | null,
): void {
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  }
  u.rate = 0.95;
  u.pitch = 1;
}
