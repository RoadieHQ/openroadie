export type {
  FieldProfile,
  FieldProfileSet,
  SearchResult,
} from './field-profiling';
export {
  applyPersonNameAliasesToExtracted,
  buildFieldProfiles,
  buildValueToFieldsMap,
  extractStringValues,
  findPathsForValue,
} from './field-profiling';

export type {
  CandidateMatch,
  FieldMatch,
  FieldMatchSource,
} from './field-match-builder';
export {
  buildFieldMatchSuggestions,
  buildTargetProfilesFromObjects,
  sourceFieldPriority,
} from './field-match-builder';
