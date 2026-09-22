import { useCallback } from 'react';
import { Button, type ButtonProps } from '@roadiehq/ui/button';
import { useAISettingsContext } from './ai-settings-context';

export interface AIButtonProps extends ButtonProps {
  onClick?: () => void;
}

export function AIButton({ onClick, ...props }: AIButtonProps) {
  const { isConfigured, openSettingsDialog } = useAISettingsContext();

  const handleClick = useCallback(() => {
    if (!isConfigured) {
      openSettingsDialog();
      return;
    }
    onClick?.();
  }, [isConfigured, openSettingsDialog, onClick]);

  return <Button {...props} onClick={handleClick} />;
}
