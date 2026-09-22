// Canonical casing for acronyms that appear inside relationship-type verbs, so
// the humanized label reads "GitHub"/"ECR" rather than "Github"/"Ecr".
const ACRONYMS: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  ecr: 'ECR',
  aws: 'AWS',
  gcp: 'GCP',
  api: 'API',
  http: 'HTTP',
  https: 'HTTPS',
  url: 'URL',
  uri: 'URI',
  id: 'ID',
  sql: 'SQL',
  sso: 'SSO',
  ai: 'AI',
};

/**
 * Turn a camelCase relationship verb into a human-readable label, e.g.
 * `builtFromGithubRepository` → "Built from GitHub repository". The first word
 * is capitalized, the rest lower-cased, and known acronyms are fixed up.
 */
export function humanizeRelationshipType(relationshipType: string): string {
  const words = relationshipType
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s._-]+/)
    .filter(Boolean);

  if (words.length === 0) {
    return relationshipType.trim();
  }

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[`${lower}`]) {
        return ACRONYMS[`${lower}`];
      }
      if (index === 0) {
        return word.charAt(0).toUpperCase() + lower.slice(1);
      }
      return lower;
    })
    .join(' ');
}

/** Same as {@link humanizeRelationshipType} but with a leading capital, for
 * standalone labels (table cells, badges): `ownerOf` → "Owner of". */
export function humanizeRelationshipTypeLabel(
  relationshipType: string,
): string {
  const label = humanizeRelationshipType(relationshipType);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
