import crypto from 'node:crypto';

import zxcvbn from 'zxcvbn';

const MIN_SCORE = Number(process.env.MIN_PASSWORD_SCORE) || 3;
const MIN_LENGTH = Number(process.env.MIN_PASSWORD_LENGTH) || 12;
// TODO: add your app name and domain words so zxcvbn penalizes them
const CONTEXT_WORDS = ['projectname'];

export function validatePasswordStrength(password, userInputs = []) {
    const result = zxcvbn(password, [...userInputs.filter(Boolean), ...CONTEXT_WORDS]);

    if (result.score < MIN_SCORE) {
        return {
            valid: false,
            score: result.score,
            feedback: result.feedback.warning
                || result.feedback.suggestions[0]
                || 'Password is too weak',
            suggestions: result.feedback.suggestions,
            crackTime: result.crack_times_display.offline_slow_hashing_1e4_per_second,
        };
    }

    if (password.length < MIN_LENGTH) {
        return {
            valid: false,
            score: result.score,
            feedback: `Password must be at least ${MIN_LENGTH} characters`,
            suggestions: ['Use a longer password or passphrase'],
        };
    }

    return { valid: true, score: result.score };
}

// haveibeenpwned k-anonymity check — only the first 5 chars of the SHA-1
// leave the server. Fails OPEN on network errors so signup works offline.
export async function isPwnedPassword(password) {
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    try {
        const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
            headers: { 'Add-Padding': 'true' },
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
            return false;
        }
        const text = await response.text();
        return text.split('\n').some((line) => line.startsWith(suffix));
    } catch (err) {
        console.warn('[passwordPolicy] HIBP check unavailable, skipping:', err.message);
        return false;
    }
}

// Full policy: zxcvbn score + length, then breach database.
export async function validateNewPassword(password, userInputs = []) {
    const strength = validatePasswordStrength(password, userInputs);
    if (!strength.valid) {
        return strength;
    }

    if (await isPwnedPassword(password)) {
        return {
            valid: false,
            score: strength.score,
            feedback: 'This password has appeared in a data breach and cannot be used. Please choose a different password.',
            suggestions: ['Use a unique password you have never used elsewhere'],
        };
    }

    return { valid: true, score: strength.score };
}
