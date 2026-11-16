const storageKey = "wpvlhc-gallery-session";

export function createGuestSession({ api, getVerification = () => "", onSessionError = () => {}, storage = () => localStorage, now = () => Date.now() }) {
  let current, pending;
  const valid = value => typeof value?.sessionToken === "string" && value.sessionToken.length > 0 && Date.parse(value.expiresAt) > now() + 5000;
  const read = () => { try { return JSON.parse(storage().getItem(storageKey) || "null"); } catch { return null; } };
  async function getToken({ rejectedToken } = {}) {
    current ||= read();
    // A second in-flight rejection must not discard a newer session.
    if (rejectedToken && current?.sessionToken === rejectedToken) {
      current = null;
      try { storage().removeItem(storageKey); } catch {}
    }
    if (valid(current)) return current.sessionToken;
    if (!pending) pending = (async () => {
      // Verification may still be pending. Do not send an empty or expired challenge.
      const turnstileToken = await getVerification();
      try {
        const result = await api("/gallery/sessions", { turnstileToken });
        if (!valid(result)) throw new Error("Unable to open photo sharing. Please retry.");
        current = result;
        try { storage().setItem(storageKey, JSON.stringify(result)); } catch {}
        return result.sessionToken;
      } catch (error) {
        // A challenge is single-use, including an uncertain network outcome. Recover
        // once per shared session request, rather than once per waiting photo.
        onSessionError(error);
        throw error;
      }
    })().finally(() => { pending = null; });
    return pending;
  }
  getToken.hasValidSession = () => { current ||= read(); return valid(current); };
  getToken.isPending = () => !!pending;
  return getToken;
}
