type OpenOptionModal = { token: symbol; close: () => void };
const openModals: OpenOptionModal[] = [];
let previousOverflow = "";

/** Option pickers share one scroll lock, including when opened over another dialog. */
export function registerOptionModal(close: () => void) {
  const token = Symbol("option-modal");
  if (!openModals.length) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  openModals.push({ token, close });
  return {
    isTop: () => openModals.at(-1)?.token === token,
    dispose: () => {
      const index = openModals.findIndex(item => item.token === token);
      if (index !== -1) openModals.splice(index, 1);
      if (!openModals.length && document.body.style.overflow === "hidden") {
        document.body.style.overflow = previousOverflow;
      }
    },
  };
}

/** The Android Back button closes the picker before navigating away. */
export function dismissTopOptionModal() {
  const top = openModals.at(-1);
  if (!top) return false;
  top.close();
  return true;
}
