/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

// GitLab returns parent_id and full_path on each group. After listing every
// group (including subgroups), join parent metadata from the same page batch
// so relationship rules can target parentGroupId, ancestorGroupIds, and rootGroupId.
const ENRICH_GROUP_HIERARCHY = `$map($, function($g) {
  (
    $parentId := $g.parent_id;
    $parent := $parentId ? $[id = $parentId][0];
    $getAncestors := function($groupId) {
      (
        $p := $[id = $groupId][0];
        $p.parent_id
          ? $append($getAncestors($p.parent_id), [$string($groupId)])
          : [$string($groupId)]
      )
    };
    $ancestorGroupIds := $parentId ? $getAncestors($parentId) : [];
    $merge([$g, {
      "parentGroupId": $parentId ? $string($parentId),
      "isSubgroup": $parentId != null,
      "ancestorGroupIds": $ancestorGroupIds,
      "rootGroupId": $count($ancestorGroupIds) > 0 ? $ancestorGroupIds[0] : $string($g.id),
      "groupDepth": $count($split($g.full_path, "/")),
      "parentGroup": $parent ? {
        "id": $string($parent.id),
        "full_path": $parent.full_path,
        "name": $parent.name,
        "path": $parent.path
      }
    }])
  )
})`;

module.exports = {
  name: 'GitLab groups',
  description:
    'List GitLab groups and subgroups (all_available), enriching each record with parentGroupId, ancestorGroupIds, rootGroupId, and a parentGroup snapshot for hierarchy relationships.',
  integrationSlug: 'gitlab',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-groups',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/v4/groups?all_available=true',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: '$string(id)',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List groups',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-groups'),
        edge('e2', 'list-groups', 'sink', ENRICH_GROUP_HIERARCHY),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
