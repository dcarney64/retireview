/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Plus Jakarta Sans', 'DM Sans', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
            },
            colors: {
                brand: {
                    bg: 'var(--color-bg)',
                    surface: 'var(--color-surface)',
                    surface2: 'var(--color-surface-2)',
                    border: 'var(--color-border)',
                    text: 'var(--color-text)',
                    text2: 'var(--color-text-2)',
                    primary: 'var(--color-primary)',
                    gain: 'var(--color-gain)',
                    loss: 'var(--color-loss)',
                    cash: 'var(--color-cash)',
                    gold: 'var(--color-gold)',
                },
            },
            spacing: {
                sidebar: 'var(--sidebar-width)',
                topbar: 'var(--topbar-height)',
            },
        },
    },
    plugins: [],
};
