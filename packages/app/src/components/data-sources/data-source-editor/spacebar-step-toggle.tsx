import { useEffect, useRef } from 'react';
import { useDataSourceEditorContext } from './data-source-editor-context';

export function SpacebarStepToggle() {
  const { selectedSteps, expandedStep, setExpandedStep } =
    useDataSourceEditorContext();
  const selectedStepsRef = useRef(selectedSteps);
  const expandedStepRef = useRef(expandedStep);
  selectedStepsRef.current = selectedSteps;
  expandedStepRef.current = expandedStep;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const currentSteps = selectedStepsRef.current;
      if (event.code !== 'Space' || currentSteps.length === 0) {
        return;
      }
      if (currentSteps.length > 1) {
        return;
      }
      const current = currentSteps[0];
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      setExpandedStep(expandedStepRef.current === current ? null : current);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setExpandedStep]);

  return null;
}
