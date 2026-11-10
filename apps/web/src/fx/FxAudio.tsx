import { useEffect } from 'react';
import { playCue, setAudio, unlockAudio } from './audio';
import { fxPlayer } from './player';
import { useFxSettings } from './settings';

/** Mounted once: plays cue sounds and keeps the audio settings in sync. */
export function FxAudio() {
  const { sound, volume } = useFxSettings();
  useEffect(() => setAudio(sound, volume), [sound, volume]);
  useEffect(() => {
    const unlock = () => unlockAudio();
    // A mouse button going down counts as the player's go-ahead; on a touch screen only the end of a tap does.
    const events = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, unlock, { capture: true, passive: true });
    const off = fxPlayer.onCue(playCue);
    return () => {
      for (const e of events) window.removeEventListener(e, unlock, { capture: true });
      off();
    };
  }, []);
  return null;
}
