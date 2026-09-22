import { useState, useEffect, useRef, useCallback } from 'react';

interface UseEditableNameOptions {
  name: string;
  onNameChange: (name: string) => void;
}

export function useEditableName({
  name,
  onNameChange,
}: UseEditableNameOptions) {
  const [isEditing, setIsEditing] = useState(false);
  const [localName, setLocalName] = useState(name);
  const skipBlurSaveRef = useRef(false);

  useEffect(() => {
    setLocalName(name);
  }, [name]);

  const startEditing = useCallback(() => {
    skipBlurSaveRef.current = false;
    setIsEditing(true);
  }, []);

  const handleChange = useCallback((value: string) => {
    setLocalName(value);
  }, []);

  // Commit synchronously on blur. Blur fires before the click that caused it
  // is handled, so a Save button pressed mid-edit sees the committed value —
  // a debounced commit here would let that click submit a stale value.
  const handleBlur = useCallback(() => {
    setIsEditing(false);
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false;
      return;
    }
    onNameChange(localName);
  }, [onNameChange, localName]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        // preventDefault stops the keystroke's derived actions (implicit form
        // submission, and button activation once focus returns to the
        // trigger) from firing after the input unmounts.
        e.preventDefault();
        skipBlurSaveRef.current = true;
        setIsEditing(false);
        onNameChange(localName);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        skipBlurSaveRef.current = true;
        setLocalName(name);
        setIsEditing(false);
      }
    },
    [name, localName, onNameChange],
  );

  return {
    isEditing,
    localName,
    startEditing,
    handleChange,
    handleBlur,
    handleKeyDown,
  };
}
