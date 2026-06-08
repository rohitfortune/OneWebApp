export let globalAlert = async (message: string, title?: string): Promise<void> => {
  window.alert(`${title ? title + '\\n\\n' : ''}${message}`);
};

export let globalPrompt = async (message: string, title?: string): Promise<string | null> => {
  return window.prompt(`${title ? title + '\\n\\n' : ''}${message}`);
};

export const setGlobalDialogHandlers = (
  alertHandler: (message: string, title?: string) => Promise<void>,
  promptHandler: (message: string, title?: string) => Promise<string | null>
) => {
  globalAlert = alertHandler;
  globalPrompt = promptHandler;
};
