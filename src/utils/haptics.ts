import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

export const triggerHapticLight = async () => {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.impact({ style: ImpactStyle.Light });
    } else if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  } catch (e) {
    // Ignore errors on devices that do not support haptics
    console.warn('Haptics failed', e);
  }
};

export const triggerHapticMedium = async () => {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } else if (navigator.vibrate) {
      navigator.vibrate(30);
    }
  } catch (e) {
    // Ignore
  }
};

export const triggerHapticError = async () => {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.notification({ type: 'ERROR' as any });
    } else if (navigator.vibrate) {
      navigator.vibrate([30, 50, 30]);
    }
  } catch (e) {
    // Ignore
  }
};
