/* ============================================================================
   LiteDAW · GLOBAL SETTINGS
   The artifact/defect filter, master level, scope styling and interface
   preferences. Persisted so the instrument remembers how it was set up.
   ========================================================================= */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ScopeThemeId = 'avionics' | 'amber' | 'mono' | 'aqua';

export interface SettingsState {
  /** Semi-realistic artifact/defect layer. */
  fxEnabled: boolean;
  /** 0..1 strength of the defect layer. */
  fxIntensity: number;
  fxScanlines: boolean;
  fxGrain: boolean;
  fxChroma: boolean;
  fxVignette: boolean;
  masterVolume: number;
  scopeTheme: ScopeThemeId;
  /** Interface scale for small screens. */
  density: 'comfortable' | 'compact';
  /** Reduces non-essential animation. */
  motion: 'full' | 'reduced';
  showTips: boolean;
  scopeFps: 30 | 60;
  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  reset: () => void;
}

const DEFAULTS = {
  fxEnabled: true,
  fxIntensity: 0.8,
  fxScanlines: true,
  fxGrain: true,
  fxChroma: true,
  fxVignette: true,
  masterVolume: 0.9,
  scopeTheme: 'avionics' as ScopeThemeId,
  density: 'comfortable' as const,
  motion: 'full' as const,
  showTips: true,
  scopeFps: 60 as const,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'litedaw.settings',
      version: 2,
      partialize: (s) => {
        const { set: _s, reset: _r, ...rest } = s;
        return rest;
      },
    },
  ),
);

/** Applies the settings to the document root as CSS custom properties. */
export function applySettingsToDom(s: SettingsState) {
  const root = document.documentElement;
  root.dataset.fx = s.fxEnabled ? 'on' : 'off';
  root.dataset.motion = s.motion;
  root.dataset.density = s.density;
  const i = s.fxEnabled ? Math.max(0, Math.min(1, s.fxIntensity)) : 0;
  root.style.setProperty('--fx', String(i));
  root.style.setProperty('--fx-scan', String(0.062 * i * (s.fxScanlines ? 1 : 0)));
  root.style.setProperty('--fx-noise', String(0.055 * i * (s.fxGrain ? 1 : 0)));
  root.style.setProperty('--fx-chroma', String(0.55 * i * (s.fxChroma ? 1 : 0)));
  root.style.setProperty('--fx-vignette', String(0.6 * i * (s.fxVignette ? 1 : 0)));
  root.style.setProperty('--fx-bloom', String(0.45 * i));
  root.style.setProperty('--fx-aero', String(0.22 + 0.4 * i));
}

/** Imperative bridge for the FX level used inside canvas painters. */
let fxCache = 1;
export const currentFxLevel = () => fxCache;
applySettingsToDom(useSettings.getState());
useSettings.subscribe((s) => {
  fxCache = s.fxEnabled ? Math.max(0, Math.min(1, s.fxIntensity)) : 0;
  applySettingsToDom(s);
});
fxCache = useSettings.getState().fxEnabled ? useSettings.getState().fxIntensity : 0;
