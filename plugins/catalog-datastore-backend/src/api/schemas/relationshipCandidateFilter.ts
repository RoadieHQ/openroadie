import type { RelationshipSuggestionValueType } from '@roadiehq/catalog-datastore-common';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERSON_NAME_PATTERN = /^\p{Lu}\p{Ll}+(?:[\s'-]\p{Lu}\p{Ll}+)+$/u;
const URL_OR_URN_PATTERN = /^(https?:\/\/|urn:)[^\s]+$/i;
const ISO_DATE_OR_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const FLOAT_PATTERN = /^\d+\.\d+$/;
const NUMERIC_ID_MIN_DIGITS = 2;
const NUMERIC_ID_PATTERN = new RegExp(`^\\d{${NUMERIC_ID_MIN_DIGITS},}$`);
const DELIMITED_TOKEN_PATTERN = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)+$/;
const MIXED_TOKEN_PATTERN =
  /^(?=.*(?:[A-Z]|\d|[_-]))[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const HIGH_ENTROPY_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]{8,}$/;
const SIMPLE_TOKEN_PATTERN = /^[A-Za-z][A-Za-z0-9]{1,63}$/;

const PERSON_NAME_TOKEN_SPLIT = /[\s'.-]+/;

function normalizeLatinToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

export function expandIdentifierSearchAliases(value: string): string[] {
  const valueType = classifyRelationshipCandidateValue(value);
  if (valueType !== 'handle' && valueType !== 'slug') {
    return [];
  }
  if (/[._:-]/.test(value)) {
    return [];
  }
  const normalized = normalizeLatinToken(value);
  if (normalized.length < 4) {
    return [];
  }
  const withoutTrailingDigits = normalized.replace(/\d+$/g, '');
  return Array.from(
    new Set(
      [normalized, withoutTrailingDigits].filter(alias => alias.length >= 4),
    ),
  ).filter(alias => alias !== value.toLowerCase());
}

/**
 * Derives additional search tokens from person-shaped display names so
 * handle-like logins (e.g. initial + surname) participate in the same
 * overlap search as literal names — without any per-entity hardcoding.
 */
export function expandPersonNameSearchAliases(value: string): string[] {
  const trimmed = value.trim();
  if (classifyRelationshipCandidateValue(trimmed) !== 'person_name') {
    return [];
  }
  const tokens = trimmed
    .split(PERSON_NAME_TOKEN_SPLIT)
    .map(normalizeLatinToken)
    .filter(t => t.length > 0);
  if (tokens.length < 2) {
    return [];
  }
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  if (last.length < 3) {
    return [];
  }
  const initial = first[0]!.toLowerCase();
  const lastLower = last.toLowerCase();
  const initialSurname = `${initial}${lastLower}`;
  if (initialSurname.length < 4) {
    return [];
  }
  const compact = tokens.map(t => t.toLowerCase()).join('');
  const out: string[] = [];
  if (classifyRelationshipCandidateValue(initialSurname) !== null) {
    out.push(initialSurname);
  }
  if (
    compact.length >= 6 &&
    compact !== initialSurname &&
    classifyRelationshipCandidateValue(compact) !== null
  ) {
    out.push(compact);
  }
  return out;
}

export function classifyRelationshipCandidateValue(
  value: string,
): RelationshipSuggestionValueType | null {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 200) {
    return null;
  }
  if (UUID_PATTERN.test(trimmed)) {
    return 'uuid';
  }
  if (EMAIL_PATTERN.test(trimmed)) {
    return 'email';
  }
  if (PERSON_NAME_PATTERN.test(trimmed)) {
    return 'person_name';
  }
  if (ISO_DATE_OR_DATE_TIME_PATTERN.test(trimmed)) {
    return null;
  }
  if (URL_OR_URN_PATTERN.test(trimmed)) {
    return 'other';
  }
  // Floats must not fall through to DELIMITED_TOKEN_PATTERN, which would
  // otherwise read the decimal point as a delimiter and classify them 'slug'.
  if (FLOAT_PATTERN.test(trimmed)) {
    return null;
  }
  if (NUMERIC_ID_PATTERN.test(trimmed)) {
    return 'numeric_id';
  }
  if (DELIMITED_TOKEN_PATTERN.test(trimmed)) {
    return /[A-Z_]/.test(trimmed) ? 'handle' : 'slug';
  }
  if (HIGH_ENTROPY_PATTERN.test(trimmed) || MIXED_TOKEN_PATTERN.test(trimmed)) {
    return 'handle';
  }
  if (SIMPLE_TOKEN_PATTERN.test(trimmed) && !trimmed.includes(' ')) {
    return 'handle';
  }
  return null;
}

export function isRelationshipCandidate(value: string): boolean {
  return classifyRelationshipCandidateValue(value) !== null;
}
