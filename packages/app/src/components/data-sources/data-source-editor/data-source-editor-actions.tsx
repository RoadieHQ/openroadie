/*
 * Copyright 2025 Larder Software Limited
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

import { History, Play, Power, Trash2 } from 'lucide-react';
import {
  EditorActionsMenu,
  type EditorActionMenuItem,
} from '../../common/pipeline-editor';
import { getDataSourceToggleActionLabel } from '../data-source-status';

interface DataSourceEditorActionsProps {
  enabled: boolean;
  canToggle: boolean;
  canRun: boolean;
  /** A manual run is in flight; shows "Running…" and keeps the item disabled. */
  isRunning: boolean;
  canDelete: boolean;
  canOpenInspector: boolean;
  /**
   * Tooltip for "Run once": an informational hint when clickable, otherwise why
   * it's disabled.
   */
  runTooltip: string;
  /**
   * Tooltip for the enable/disable action: an informational hint when clickable,
   * otherwise why it's disabled.
   */
  toggleTooltip: string;
  onRun: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onOpenInspector: () => void;
}

export function DataSourceEditorActions({
  enabled,
  canToggle,
  canRun,
  isRunning,
  canDelete,
  canOpenInspector,
  runTooltip,
  toggleTooltip,
  onRun,
  onToggleEnabled,
  onDelete,
  onOpenInspector,
}: DataSourceEditorActionsProps) {
  const items: EditorActionMenuItem[] = [
    {
      icon: <Play />,
      label: isRunning ? 'Running…' : 'Run',
      onSelect: onRun,
      disabled: !canRun,
      tooltip: runTooltip,
    },
    {
      icon: <Power />,
      label: getDataSourceToggleActionLabel(enabled),
      onSelect: onToggleEnabled,
      disabled: !canToggle,
      tooltip: toggleTooltip,
    },
    {
      icon: <History />,
      label: 'Run history',
      onSelect: onOpenInspector,
      disabled: !canOpenInspector,
      separatorBefore: true,
    },
    {
      icon: <Trash2 />,
      label: 'Delete',
      onSelect: onDelete,
      disabled: !canDelete,
      destructive: true,
      separatorBefore: true,
    },
  ];

  return (
    <EditorActionsMenu items={items} testId="data-source-actions-button" />
  );
}
