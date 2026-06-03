import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rohitfortune.onewebapp',
  appName: 'OneWebApp',
  webDir: 'dist',
  plugins: {
    PrivacyScreen: {
      enable: true,
    }
  }
};

export default config;
