/**
 * Fidelity Private Client Group PDF statement parser.
 *
 * Extracts from each monthly statement:
 *   – Statement end date       (from "INVESTMENT REPORT\nMonth D, YYYY - Month D, YYYY")
 *   – Total portfolio value    (from "Your Portfolio Value:\n$XX,XXX.XX")
 *   – Per-account balances     (from Portfolio Summary table)
 *
 * Uses pdf-parse v1.1.1 via createRequire.
 * pdf-parse v2 fails in Node 18/20 with "DOMMatrix is not defined" because it
 * bundles pdfjs-dist which requires browser globals; v1.1.1 uses an older
 * pdfjs that works in a plain Node environment.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// ─── Account-type keyword maps ────────────────────────────────────────────────

const RETIREMENT_KEYWORDS = [
    'HEALTH SAVINGS',
    'ROTH',
    '401K',
    '401(K)',
    'IRA',
    'PENSION',
];

// Map month names to zero-padded MM strings
const MONTH_MAP = {
    January: '01', February: '02', March: '03', April: '04',
    May: '05', June: '06', July: '07', August: '08',
    September: '09', October: '10', November: '11', December: '12',
};

// Section-header lines that appear between account rows in Portfolio Summary
const SECTION_HEADERS = new Set([
    'GENERAL INVESTMENTS',
    'PERSONAL RETIREMENT',
    'HEALTH SAVINGS ACCOUNT',
    'RETIREMENT',
]);

// Regex patterns for noise lines to strip when building account names
const NOISE_PATTERNS = [
    /^Portfolio Summary/i,
    /^INVESTMENT REPORT$/,
    /^\w+ \d+, \d{4} - \w+ \d+, \d{4}$/, // date range header
    /^Accounts Included/i,
    /PageAccount/i,
    /^Account$/,
    /^Number/,
    /Beginning Value/i,
    /Ending Value/i,
    /^\d+ of \d+$/,     // "2 of 32"
    /^MR_CE /,          // page-identifier stamp
    /^S$/,              // page stamp continuation
    /^\d+$/,            // lone digit (page number)
    /^Page$/,
    /^Save on your tax/,
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a Fidelity Private Client Group PDF statement.
 *
 * @param {Buffer} buffer  Raw PDF bytes
 * @returns {Promise<{
 *   statementDate: string|null,  // ISO "YYYY-MM-DD", the statement END date
 *   totalValue:    number|null,  // total portfolio value
 *   accounts:      ParsedAccount[],
 *   warnings:      string[],
 * }>}
 *
 * @typedef {{
 *   accountNumber:     string,
 *   accountName:       string,   // cleaned text from Portfolio Summary
 *   accountType:       string,   // 'brokerage' | 'retirement'
 *   beginningBalance:  number|null,
 *   endingBalance:     number,   // always > 0 (zero/dash rows are skipped)
 * }} ParsedAccount
 */
export async function parseFidelityPDF(buffer) {
    let data;
    try {
        data = await pdfParse(buffer);
    } catch (err) {
        throw Object.assign(
            new Error(`PDF text extraction failed: ${err.message}`),
            { status: 422 }
        );
    }
    return parsePDFText(data.text);
}

// ─── Internal parsing ─────────────────────────────────────────────────────────

function parsePDFText(text) {
    const warnings = [];

    // ── 1. Statement end date ─────────────────────────────────────────────────
    let statementDate = null;
    const dateMatch = text.match(/INVESTMENT REPORT\n(\w+ \d+, \d{4}) - (\w+ \d+, \d{4})/);
    if (dateMatch) {
        statementDate = parseMonthDayYear(dateMatch[2]);
        if (!statementDate) warnings.push(`Could not parse statement end date: "${dateMatch[2]}"`);
    } else {
        warnings.push('Could not locate statement date in PDF.');
    }

    // ── 2. Total portfolio value ───────────────────────────────────────────────
    let totalValue = null;
    const totalMatch = text.match(/Your Portfolio Value:\n\$?([\d,]+\.\d{2})/);
    if (totalMatch) {
        totalValue = parseAmount(totalMatch[1]);
    } else {
        warnings.push('Could not locate "Your Portfolio Value" in PDF.');
    }

    // ── 3. Portfolio Summary section ─────────────────────────────────────────
    const summaryStart = text.indexOf('Portfolio Summary');
    if (summaryStart === -1) {
        warnings.push('Could not find Portfolio Summary section in PDF.');
        return { statementDate, totalValue, accounts: [], warnings };
    }

    // "Ending Portfolio Value" marks the end of the per-account table
    const endingIdx  = text.indexOf('Ending Portfolio Value', summaryStart);
    const summaryText = endingIdx !== -1
        ? text.slice(summaryStart, endingIdx)
        : text.slice(summaryStart, summaryStart + 10_000); // generous fallback

    // ── 4. Account rows from Portfolio Summary ────────────────────────────────
    const accounts = parsePortfolioSummary(summaryText, warnings);

    return { statementDate, totalValue, accounts, warnings };
}

/**
 * Extract per-account rows from the Portfolio Summary section.
 *
 * PDF text layout (after pdf-parse extraction):
 *   Single-line row (short name):
 *     "FIDELITY ACCOUNT DONALD L CARNEY II - INDIVIDUAL TODX65-277290$28,068.89$26,516.024"
 *   Single-line row with dash balances:
 *     "FIDELITY ACCOUNT DONALD L CARNEY II - INDIVIDUALZ31-612054--9"
 *   Multi-line row (long name, custodian on separate line):
 *     "FIDELITY TRADITIONAL IRA DONALD L CARNEY II - TRADITIONAL IRA -\n"
 *     "FIDELITY MANAGEMENT TRUST CO - CUSTODIAN\n"
 *     "262-80772661.8610.3210"
 *
 * Pattern matched at the account-number boundary:
 *   ([A-Z]NN|NNN)-NNNNNN  +  value  +  value  +  page#
 *
 * Value can be: "$N,NNN.NN"  |  "N,NNN.NN"  |  "NN.NN"  |  "-"
 * [\d,]+ naturally stops at a decimal point, so consecutive values parse correctly.
 */
function parsePortfolioSummary(text, warnings) {
    const accounts = [];

    // Regex: account-number  beginning-value  ending-value  page-number
    const acctRe = /([A-Z]\d{2}|\d{3})-(\d{6})(\$?[\d,]+\.\d{2}|-)(\$?[\d,]+\.\d{2}|-)(\d+)/g;

    let prevEnd = 0;
    let match;

    while ((match = acctRe.exec(text)) !== null) {
        const [fullMatch, prefix, suffix, beginStr, endStr] = match;
        const accountNumber = `${prefix}-${suffix}`;

        // Text from the previous match's end to this match's start = account name
        const precedingText = text.slice(prevEnd, match.index);
        const accountName   = cleanAccountName(precedingText);
        const accountType   = detectAccountType(accountName);

        const beginningBalance = parseAmount(beginStr);
        const endingBalance    = parseAmount(endStr);

        prevEnd = match.index + fullMatch.length;

        // Skip accounts with no ending balance (dash) or zero value
        if (endingBalance === null || endingBalance === 0) continue;

        accounts.push({
            accountNumber,
            accountName: accountName || `Account ${accountNumber}`,
            accountType,
            beginningBalance,
            endingBalance,
        });
    }

    if (accounts.length === 0) {
        warnings.push('No non-zero account balances found in Portfolio Summary.');
    }

    return accounts;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip section headers and PDF artifacts from preceding text to extract the account name. */
function cleanAccountName(raw) {
    return raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .filter((l) => !SECTION_HEADERS.has(l))
        .filter((l) => !NOISE_PATTERNS.some((re) => re.test(l)))
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/** Map cleaned account name to a RetireView account type. */
function detectAccountType(name) {
    const u = name.toUpperCase();
    for (const kw of RETIREMENT_KEYWORDS) {
        if (u.includes(kw)) return 'retirement';
    }
    return 'brokerage'; // INDIVIDUAL TOD, INDIVIDUAL, or unknown → brokerage
}

/** Derive a short human-readable name for a new account created from a PDF import. */
export function deriveAccountName(fullName) {
    const u = fullName.toUpperCase();
    if (u.includes('ROTH SELF-EMPLOYED 401K') || u.includes('ROTH SELF-EMPLOYED 401(K)')) return 'Roth 401(k)';
    if (u.includes('SELF-EMPLOYED 401K')      || u.includes('SELF-EMPLOYED 401(K)'))      return 'Self-Employed 401(k)';
    if (u.includes('ROTH IRA'))   return 'Roth IRA';
    if (u.includes('ROTH'))       return 'Roth 401(k)';
    if (u.includes('TRADITIONAL IRA')) return 'Traditional IRA';
    if (u.includes('HEALTH SAVINGS')) return 'Health Savings Account (HSA)';
    if (u.includes('INDIVIDUAL TOD')) return 'Individual TOD';
    if (u.includes('INDIVIDUAL'))     return 'Individual';
    return fullName.slice(0, 60).trim();
}

/** Parse "$28,068.89" | "28,068.89" | "61.86" → number; "-" → null. */
function parseAmount(str) {
    if (!str || str === '-') return null;
    const val = parseFloat(str.replace(/[$,]/g, ''));
    return Number.isFinite(val) ? val : null;
}

/** Parse "March 31, 2026" → "2026-03-31". */
function parseMonthDayYear(str) {
    const m = str.trim().match(/^(\w+)\s+(\d+),\s+(\d{4})$/);
    if (!m) return null;
    const [, month, day, year] = m;
    const mm = MONTH_MAP[month];
    if (!mm) return null;
    return `${year}-${mm}-${day.padStart(2, '0')}`;
}
