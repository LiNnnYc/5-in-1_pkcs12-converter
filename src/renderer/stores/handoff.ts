import { ref } from "vue";

export type TabId = "merge" | "extract" | "view" | "jksToP12" | "jksFromP12";

export type HandoffPayload =
  | { target: "jksFromP12"; pfxFile: string; pfxPassword: string }
  | { target: "extract"; pfxFile: string; pfxPassword: string };

// Handoff payloads carry plaintext passwords. They must not linger in memory
// past the brief window between the user clicking a "continue to next step"
// button and the destination page mounting + consuming. If the destination
// tab is never visited, expire the payload so the password stops being
// resident after a short grace period.
const PAYLOAD_TTL_MS = 60_000;

const activeTab = ref<TabId>("merge");
const pending = ref<HandoffPayload | null>(null);
let expireTimer: ReturnType<typeof setTimeout> | null = null;

function scrub(): void {
  pending.value = null;
  if (expireTimer !== null) {
    clearTimeout(expireTimer);
    expireTimer = null;
  }
}

function armExpiry(): void {
  if (expireTimer !== null) clearTimeout(expireTimer);
  expireTimer = setTimeout(() => {
    pending.value = null;
    expireTimer = null;
  }, PAYLOAD_TTL_MS);
}

export function useHandoff() {
  return {
    activeTab,
    navigate(tab: TabId, payload: HandoffPayload) {
      pending.value = payload;
      armExpiry();
      activeTab.value = tab;
    },
    setActiveTab(tab: TabId) {
      scrub();
      activeTab.value = tab;
    },
    consume<T extends HandoffPayload["target"]>(
      target: T
    ): Extract<HandoffPayload, { target: T }> | null {
      const current = pending.value;
      if (current && current.target === target) {
        scrub();
        return current as Extract<HandoffPayload, { target: T }>;
      }
      return null;
    },
    // Exposed for tests — production callers should not read this directly.
    _peekPending(): HandoffPayload | null {
      return pending.value;
    }
  };
}
