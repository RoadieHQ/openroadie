import { describe, it, expect } from 'vitest';
import {
  activePreset,
  autoLabel,
  buildBundlePreviewJson,
  deriveView,
  excludeProjection,
  includeProjection,
} from './projection-utils';

describe('projection-utils', () => {
  describe('autoLabel', () => {
    it('uses the leaf segment when unambiguous', () => {
      expect(autoLabel('metadata.role', ['metadata.role', 'name'])).toBe(
        'role',
      );
    });
    it('disambiguates colliding leaves to the last two segments', () => {
      expect(autoLabel('metadata.name', ['metadata.name', 'owner.name'])).toBe(
        'metadata.name',
      );
    });
  });

  describe('includeProjection', () => {
    it('builds include fields with auto labels', () => {
      expect(includeProjection(['name', 'metadata.role'])).toEqual({
        mode: 'include',
        fields: [
          { source: 'name', label: 'name' },
          { source: 'metadata.role', label: 'role' },
        ],
      });
    });
    it('honours label overrides', () => {
      expect(includeProjection(['name'], { name: 'fullName' })).toEqual({
        mode: 'include',
        fields: [{ source: 'name', label: 'fullName' }],
      });
    });
    it('returns undefined (full object) for an empty selection', () => {
      expect(includeProjection([])).toBeUndefined();
    });
  });

  describe('excludeProjection', () => {
    it('builds an exclude projection', () => {
      expect(excludeProjection(['secret'])).toEqual({
        mode: 'exclude',
        paths: ['secret'],
      });
    });
    it('returns undefined when nothing is excluded', () => {
      expect(excludeProjection([])).toBeUndefined();
    });
  });

  describe('deriveView', () => {
    const allPaths = ['name', 'role', 'secret'];
    it('treats no projection as full (all kept)', () => {
      const view = deriveView(undefined, allPaths);
      expect(view.isFull).toBe(true);
      expect([...view.kept].sort()).toEqual([...allPaths].sort());
    });
    it('reads an include projection', () => {
      const view = deriveView(
        { mode: 'include', fields: [{ source: 'name', label: 'n' }] },
        allPaths,
      );
      expect(view.mode).toBe('include');
      expect([...view.kept]).toEqual(['name']);
      expect(view.labels).toEqual({ name: 'n' });
    });
    it('reads an exclude projection as kept = all minus excluded', () => {
      const view = deriveView({ mode: 'exclude', paths: ['secret'] }, allPaths);
      expect(view.mode).toBe('exclude');
      expect([...view.kept].sort()).toEqual(['name', 'role']);
      expect([...view.excluded]).toEqual(['secret']);
    });
    it('reads the legacy bare-array form as include', () => {
      const view = deriveView([{ source: 'name', label: 'name' }], allPaths);
      expect(view.mode).toBe('include');
      expect([...view.kept]).toEqual(['name']);
    });
  });

  describe('activePreset', () => {
    const presets = { identifiers: ['id'], essentials: ['id', 'name'] };
    it('detects full', () => {
      expect(activePreset(undefined, presets)).toBe('full');
    });
    it('detects identifiers and essentials', () => {
      expect(activePreset(includeProjection(['id']), presets)).toBe(
        'identifiers',
      );
      expect(activePreset(includeProjection(['id', 'name']), presets)).toBe(
        'essentials',
      );
    });
    it('falls back to custom', () => {
      expect(activePreset(includeProjection(['name']), presets)).toBe('custom');
      expect(activePreset({ mode: 'exclude', paths: ['x'] }, presets)).toBe(
        'custom',
      );
    });
  });

  describe('buildBundlePreviewJson', () => {
    const group = {
      id: 'g1',
      name: 'Group 1',
      members: [
        {
          datasourceId: 'ds-users',
          objectId: 'r1',
          object: { name: 'Ada', secret: 'x' },
        },
        { datasourceId: 'ds-teams', objectId: 'a1', object: { team: 'core' } },
      ],
    };
    const columns = [
      { id: 'ds-users', name: 'Users' },
      { id: 'ds-teams', name: 'Teams' },
    ];

    it('includes rule-level and per-datasource annotations and projected data', () => {
      const json = buildBundlePreviewJson({
        group,
        columns,
        projectionByDatasourceId: new Map([
          [
            'ds-users',
            { mode: 'include', fields: [{ source: 'name', label: 'name' }] },
          ],
        ]),
        annotationByDatasourceId: new Map([
          ['ds-users', { title: 'People', text: 'use name' }],
        ]),
        annotations: [{ title: 'Overview', text: 'a bundle' }],
        ruleName: 'Employee',
      });

      expect(json).toEqual({
        ruleName: 'Employee',
        contextGroupName: 'Group 1',
        annotations: [{ title: 'Overview', text: 'a bundle' }],
        datasources: [
          {
            datasource: 'Users',
            annotation: { title: 'People', text: 'use name' },
            // projected — `secret` dropped
            objects: [{ objectId: 'r1', data: { name: 'Ada' } }],
          },
          {
            datasource: 'Teams',
            // no projection → full object
            objects: [{ objectId: 'a1', data: { team: 'core' } }],
          },
        ],
      });
    });

    it('drops datasource blocks with no members in the group', () => {
      const json = buildBundlePreviewJson({
        group: { ...group, members: group.members.slice(0, 1) },
        columns,
        projectionByDatasourceId: new Map(),
        annotationByDatasourceId: new Map(),
        annotations: [],
        ruleName: 'Employee',
      });
      expect(json.datasources).toEqual([
        {
          datasource: 'Users',
          objects: [{ objectId: 'r1', data: { name: 'Ada', secret: 'x' } }],
        },
      ]);
    });

    it('omits the annotations key when there are none', () => {
      const json = buildBundlePreviewJson({
        group,
        columns,
        projectionByDatasourceId: new Map(),
        annotationByDatasourceId: new Map(),
        annotations: [],
        ruleName: 'Employee',
      });
      expect(json).not.toHaveProperty('annotations');
    });
  });
});
