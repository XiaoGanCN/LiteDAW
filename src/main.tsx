import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { engine } from './audio/engine';
import { samples } from './audio/sampler';
import { applySettingsToDom, useSettings } from './state/settings';

import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/instruments.css';
import './styles/layout.css';
import './styles/pages.css';

/* Apply the persisted look before first paint, and wire global side effects. */
applySettingsToDom(useSettings.getState());
engine.bindUnlock();
void samples.restore();
// Restore the user's level whenever the context changes state (autoplay policy).
engine.onRunningChange(() => engine.setMasterVolume(useSettings.getState().masterVolume));

const host = document.getElementById('root');
if (!host) throw new Error('#root missing');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
