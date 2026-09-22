import {
  resolveContextGroupPageTitle,
  resolveFormWatchedTitle,
  resolveIntegrationPageTitle,
  resolveVersionedEntityPageTitle,
} from './entity-editor-title';

describe('entity editor title helpers', () => {
  describe('resolveVersionedEntityPageTitle', () => {
    it('returns the new label in create mode', () => {
      expect(
        resolveVersionedEntityPageTitle({
          isNew: true,
          newLabel: 'New Action',
          name: 'Ignored',
          untitledLabel: 'Untitled Action',
        }),
      ).toBe('New Action');
    });

    it('prefers a version snapshot over the live name', () => {
      expect(
        resolveVersionedEntityPageTitle({
          isNew: false,
          newLabel: 'New Action',
          name: 'Live',
          untitledLabel: 'Untitled Action',
          viewingVersion: { name: 'Snapshot', version: 3 },
        }),
      ).toBe('Snapshot (v3)');
    });

    it('falls back to the untitled label when the live name is empty', () => {
      expect(
        resolveVersionedEntityPageTitle({
          isNew: false,
          newLabel: 'New Action',
          name: '   ',
          untitledLabel: 'Untitled Action',
        }),
      ).toBe('Untitled Action');
    });
  });

  describe('resolveIntegrationPageTitle', () => {
    it('handles create, edit, and duplicate flows', () => {
      expect(
        resolveIntegrationPageTitle({
          isEdit: false,
          isDuplicate: false,
        }),
      ).toBe('New Integration');
      expect(
        resolveIntegrationPageTitle({
          isEdit: true,
          isDuplicate: false,
          entityName: ' GitHub ',
        }),
      ).toBe('GitHub');
      expect(
        resolveIntegrationPageTitle({
          isEdit: false,
          isDuplicate: true,
          entityName: 'GitHub',
        }),
      ).toBe('GitHub');
    });
  });

  describe('resolveFormWatchedTitle', () => {
    it('prefers the live field value and falls back to the page title', () => {
      expect(resolveFormWatchedTitle('  Live Name  ', 'Fallback')).toBe(
        'Live Name',
      );
      expect(resolveFormWatchedTitle('   ', 'Fallback')).toBe('Fallback');
    });
  });

  describe('resolveContextGroupPageTitle', () => {
    it('uses the new label for create and trims edit names', () => {
      expect(resolveContextGroupPageTitle(true, '')).toBe('New Context Group');
      expect(resolveContextGroupPageTitle(false, '  Team  ')).toBe('Team');
      expect(resolveContextGroupPageTitle(false, '   ')).toBe('Context Group');
    });
  });
});
