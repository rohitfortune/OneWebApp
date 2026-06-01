export const triggerHapticLight = async () => {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  } catch (e) {
    // Ignore errors on devices that do not support haptics
    console.warn('Haptics failed', e);
  }
};

export const triggerHapticMedium = async () => {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(30);
    }
  } catch (e) {
    // Ignore
  }
};

export const triggerHapticError = async () => {
  try {
    if (navigator.vibrate) {
      navigator.vibrate([30, 50, 30]);
    }
  } catch (e) {
    // Ignore
  }
};
