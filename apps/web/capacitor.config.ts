import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "trade.polyx.app",
  appName: "Polyx",
  webDir: "out",
  server: {
    // Use the production API
    url: "https://web-production-0d2ec.up.railway.app",
    cleartext: false,
  },
  ios: {
    contentInset: "automatic",
    preferredContentMode: "mobile",
    scheme: "Polyx",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#000000",
      showSpinner: false,
    },
  },
};

export default config;
