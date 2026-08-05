import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Persisted app-wide UI state. ADD YOUR UI STATE BELOW.
export const useUiStore = create(
    persist(
        (_set) => ({
            // example: sidebarCollapsed: false,
        }),
        {
            name: 'app-ui',
            storage: createJSONStorage(() => localStorage),
        }
    )
);
