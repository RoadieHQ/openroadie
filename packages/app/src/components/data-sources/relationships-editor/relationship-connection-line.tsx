import React from 'react';
import {
  getBezierPath,
  type ConnectionLineComponentProps,
} from '@xyflow/react';

export function RelationshipConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionStatus,
}: ConnectionLineComponentProps) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    targetX: toX,
    targetY: toY,
    sourcePosition: fromPosition,
    targetPosition: toPosition,
  });

  return (
    <path
      d={path}
      fill="none"
      stroke={connectionStatus === 'invalid' ? '#ef4444' : '#2DD4BF'}
      strokeDasharray="6 4"
      strokeLinecap="round"
      strokeWidth={2.5}
      opacity={connectionStatus === 'invalid' ? 0.65 : 0.9}
    />
  );
}
