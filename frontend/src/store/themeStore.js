import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useThemeStore = create(
    persist(
        (set) => ({
            theme: 'dark',

            setTheme: (theme) => {
                set({ theme });
                const html = document.documentElement;
                html.classList.remove('dark', 'light');
                html.classList.add(theme);
            },

            toggleTheme: () => {
                const current = useThemeStore.getState().theme;
                const next = current === 'dark' ? 'light' : 'dark';
                useThemeStore.getState().setTheme(next);
            },

            initTheme: () => {
                const theme = useThemeStore.getState().theme;
                document.documentElement.classList.add(theme);
            },
        }),
        { name: 'app-theme' }
    )
);
