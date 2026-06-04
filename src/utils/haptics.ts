import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export const triggerHapticLight = async () => {
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch (e) {
    console.warn('Haptics failed', e);
  }
};

export const triggerHapticMedium = async () => {
  try {
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch (e) {
    // Ignore
  }
};

export const triggerHapticError = async () => {
  try {
    await Haptics.notification({ type: NotificationType.Error });
  } catch (e) {
    // Ignore
  }
};
