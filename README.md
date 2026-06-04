# One Web: Secure Hybrid Vault & Notes Suite

One Web is a fully offline-first, highly secure digital vault, notes, and file explorer application built for Web, iOS, and Android using React and Capacitor. 

It acts as a secure, unified hub for your most private data, completely independent of third-party backend servers. All of your data lives entirely on your device, heavily encrypted at rest.

## 🌟 Features

- **Secure Notes**: Rich text editor with formatting, checklist support, multimedia embedding, and a native drawing canvas.
- **Password & Card Vault**: A highly secure vault for your passwords and credit cards.
- **Local File Manager**: Store and manage files completely offline within the app's sandboxed storage.
- **Cloud Explorers**: Natively integrated Google Drive and Microsoft OneDrive explorers.
- **Hybrid Biometrics**: Lock your vault and private notes using Face ID, Touch ID, or fingerprint authentication across Web, iOS, and Android.
- **Cloud Sync**: Securely backup and sync your encrypted database across devices using your own Microsoft OneDrive account (Merge-on-Sync).

---

## 🔒 Security & Data Handling

We take your privacy and security extremely seriously. Here is exactly how your data is handled:

### 1. Zero-Knowledge Architecture
One Web does not have a backend server. We do not host your data, we cannot see your passwords, and we cannot recover your Master Password if you lose it. All data is processed completely on your own hardware.

### 2. AES-GCM Encryption
Your sensitive data (passwords, credit cards, and locked notes) is cryptographically locked at rest using **AES-256-GCM**, the gold standard in symmetric encryption. 
When you create a Master Password, we use `PBKDF2` with a high iteration count to derive a secure 256-bit cryptographic key from it, protected by a unique randomized salt.

### 3. Hardware-Backed Biometrics
We do not store your biometric data. When you enroll biometrics:
- **On Native Apps (iOS/Android):** We utilize official Capacitor hardware APIs to interface directly with Apple's Secure Enclave and Android's Keystore system.
- **On Web Browsers:** We utilize the W3C `WebAuthn` standard to generate cryptographic public/private key pairs bound directly to your device's Platform Authenticator hardware (Touch ID/Windows Hello).

### 4. Privacy Screen Protection
When running natively on iOS or Android, One Web utilizes a Privacy Screen plugin. When you switch between apps or view the recent apps menu, the operating system will automatically blur or obscure the app window to prevent shoulder surfers or malicious screen-recording apps from seeing your unencrypted vault.

### 5. Encrypted Cloud Sync
You can choose to backup your data to your personal Microsoft OneDrive. **Your data is fully encrypted locally on your device BEFORE it is uploaded to Microsoft's servers.** The resulting backup file is completely useless without your Master Password, ensuring that neither Microsoft nor anyone else can read your data.

---

## 🚀 Installation & Usage

Because One Web is built as a hybrid application using Vite, React, and Capacitor, you can install and use it in multiple ways:

### Prerequisites for Development
- Node.js (v18+)
- Xcode (for iOS compilation)
- Android Studio (for Android compilation)

### 1. Web Application (Progressive Web App)
You can run One Web directly in your browser or install it as a PWA.
```bash
# Install dependencies
npm install

# Run the local development server
npm run dev

# Build the optimized production bundle
npm run build
```

### 2. Native iOS App
To run One Web natively on an iPhone or iPad:
```bash
# Build the web assets and sync them to the iOS project
npm run build && npx cap sync ios

# Open the project in Xcode
npx cap open ios
```
*In Xcode, select your connected iPhone or iPad, configure your Apple Developer Team in the "Signing & Capabilities" tab, and hit the Play button to compile and install!*

### 3. Native Android App
To run One Web natively on an Android device or emulator:
```bash
# Build the web assets and sync them to the Android project
npm run build && npx cap sync android

# Open the project in Android Studio
npx cap open android
```
*Alternatively, you can compile the APK directly from the command line:*
```bash
cd android && ./gradlew assembleDebug
```
*The compiled APK will be available in `android/app/build/outputs/apk/debug/app-debug.apk`.*
