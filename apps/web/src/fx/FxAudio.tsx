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
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const off = fxPlayer.onCue(playCue);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      off();
    };
  }, []);
  return null;
}
