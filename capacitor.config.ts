import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps the static export in `out/` as a native iOS app.
 *
 * There is deliberately no `server.url` here. Pointing the shell at the live
 * Vercel site would make this a WKWebView around a website, which is precisely
 * what App Review Guideline 4.2 rejects — and it would also mean the app stops
 * working the moment the crew loses signal. The UI ships inside the binary; only
 * the /api calls go out to the network.
 */
const config: CapacitorConfig = {
  appId: "com.grimebustersky.crm",
  appName: "Grime Busters",
  webDir: "out",

  ios: {
    // The app is dark end to end; a light scroll bounce flashes white.
    backgroundColor: "#0b0f14",
    contentInset: "always",
    // Links to tel:, sms: and maps: must leave the webview and hand off to iOS.
    limitsNavigationsToAppBoundDomains: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: "#0b0f14",
      showSpinner: false,
      // Firebase auth restores its session before the first screen renders;
      // hiding the splash manually avoids a flash of the login form.
      launchAutoHide: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0b0f14",
    },
    Geolocation: {
      // Justified to App Review by the "see where your partner is while you
      // split a street" use case; see docs/APP_STORE.md.
      permissions: ["location"],
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
