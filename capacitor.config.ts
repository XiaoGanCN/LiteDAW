import type { CapacitorConfig } from '@capacitor/cli';

/**
 * LiteDAW ships as a plain static web bundle. Capacitor wraps that bundle in a
 * native Android shell (WebView + AudioFocus handling) so the same build that
 * runs in a desktop browser also installs as a standalone APK/AAB.
 */
const config: CapacitorConfig = {
  appId: 'dev.litedaw.app',
  appName: 'LiteDAW',
  webDir: 'dist',
  // Relative asset URLs (vite `base: './'`) are what make this work unchanged.
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true,
    backgroundColor: '#06080A',
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: '#06080Aff',
      showSpinner: false,
    },
  },
};

export default config;
