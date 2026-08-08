import { create } from 'zustand';

import apiClient from '../api/client';

const STORAGE_KEY = 'retireview:activeProfileId';

function loadStoredProfileId() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'null' || stored === null) return null;
    const parsed = parseInt(stored, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveProfileId(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id === null ? 'null' : String(id));
  } catch {
    // ignore
  }
}

export const useProfileStore = create((set, get) => ({
  profiles: [],
  activeProfileId: loadStoredProfileId(), // null = combined; integer = specific profile
  isLoading: false,
  error: null,

  /** Load profiles from the API and restore saved selection. */
  loadProfiles: async () => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await apiClient.get('/profiles');
      const profiles = data || [];

      let activeProfileId = get().activeProfileId;

      if (!activeProfileId && profiles.length > 0) {
        // Nothing selected (first visit or cleared storage) — auto-select primary
        const primary = profiles.find((p) => p.isPrimary) || profiles[0];
        activeProfileId = primary.id;
      } else if (activeProfileId && !profiles.some((p) => p.id === activeProfileId)) {
        // Stored profile was deleted — fall back to primary
        const primary = profiles.find((p) => p.isPrimary) || profiles[0];
        activeProfileId = primary?.id ?? null;
      }

      set({ profiles, activeProfileId, isLoading: false });
      saveProfileId(activeProfileId);
    } catch (err) {
      set({ isLoading: false, error: err?.response?.data?.error || 'Failed to load profiles' });
    }
  },

  /** Switch the active profile. Pass null for combined view. */
  setActiveProfile: (profileId) => {
    set({ activeProfileId: profileId });
    saveProfileId(profileId);
  },

  /** Returns the header value to send as X-Profile-Id. */
  getHeaderValue: () => {
    const { activeProfileId } = get();
    return activeProfileId === null ? 'combined' : String(activeProfileId);
  },

  /** Convenience: the active profile object (null in combined mode). */
  activeProfile: () => {
    const { profiles, activeProfileId } = get();
    if (activeProfileId === null) return null;
    return profiles.find((p) => p.id === activeProfileId) || null;
  },
}));
