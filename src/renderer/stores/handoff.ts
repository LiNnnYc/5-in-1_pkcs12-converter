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

// Once a destination page consumes the payload, the password has moved into
// that page's reactive form state — outside this store's reach. To keep the
// TTL / tab-scrub guarantee meaningful, the consumer registers a cleanup
// callback alongside consume(); the store fires it on TTL expiry or when the
// user navigates away from the consumer tab.
type ConsumerCleanup = { tab: TabId; clear: () => void };

const activeTab = ref<TabId>("merge");
const pending = ref<HandoffPayload | null>(null);
let consumerCleanup: ConsumerCleanup | null = null;
let expireTimer: ReturnType<typeof setTimeout> | null = null;

function clearExpireTimer(): void {
  if (expireTimer !== null) {
    clearTimeout(expireTimer);
    expireTimer = null;
  }
}

function runConsumerCleanup(): void {
  if (consumerCleanup) {
    consumerCleanup.clear();
    consumerCleanup = null;
  }
}

function scrub(): void {
  pending.value = null;
  runConsumerCleanup();
  clearExpireTimer();
}

function armExpiry(): void {
  clearExpireTimer();
  expireTimer = setTimeout(() => {
    pending.value = null;
    runConsumerCleanup();
    expireTimer = null;
  }, PAYLOAD_TTL_MS);
}

export function useHandoff() {
  return {
    activeTab,
    navigate(tab: TabId, payload: HandoffPayload) {
      // A prior handoff still in a consumer form is stale once a new handoff
      // starts — clear it before replacing.
      runConsumerCleanup();
      pending.value = payload;
      armExpiry();
      activeTab.value = tab;
    },
    setActiveTab(tab: TabId) {
      // A user-initiated tab switch abandons any active handoff: both the
      // un-consumed payload and any form state the consumer page inherited.
      if (tab !== activeTab.value) {
        scrub();
      }
      activeTab.value = tab;
    },
    consume<T extends HandoffPayload["target"]>(
      target: T,
      cleanup?: () => void
    ): Extract<HandoffPayload, { target: T }> | null {
      const current = pending.value;
      if (current && current.target === target) {
        pending.value = null;
        // Previous consumer callback (if any) is superseded; the new one is
        // now responsible for clearing this handoff's residue.
        runConsumerCleanup();
        if (cleanup) {
          consumerCleanup = { tab: activeTab.value, clear: cleanup };
          // Keep the TTL running — it was armed at navigate() time and still
          // represents "how long until the handoff's plaintext must be gone".
        } else {
          // No cleanup registered → payload is fully consumed and nothing
          // else to scrub; cancel the timer.
          clearExpireTimer();
        }
        return current as Extract<HandoffPayload, { target: T }>;
      }
      return null;
    },
    // Exposed for tests — production callers should not read these directly.
    _peekPending(): HandoffPayload | null {
      return pending.value;
    },
    _peekConsumerTab(): TabId | null {
      return consumerCleanup?.tab ?? null;
    }
  };
}
