import * as React from 'react';

/**
 * Registers a document title, returning an unregister cleanup. The consuming
 * application owns the actual `<title>` element; `EditorHeader` only reports
 * the title it wants for as long as it is mounted.
 *
 * `EditorHeader` must never write `document.title` imperatively: the setter
 * mutates the first `<title>` element in the head, which is the app's
 * React-managed one — React doesn't see the mutation and won't repaint it, so
 * the tab ends up showing stale titles after navigation.
 */
export type EditorHeaderTitleRegistry = (title: string) => () => void;

const EditorHeaderTitleContext =
  React.createContext<EditorHeaderTitleRegistry | null>(null);

export function EditorHeaderTitleProvider({
  register,
  children,
}: {
  register: EditorHeaderTitleRegistry;
  children: React.ReactNode;
}) {
  return (
    <EditorHeaderTitleContext.Provider value={register}>
      {children}
    </EditorHeaderTitleContext.Provider>
  );
}

export function useEditorHeaderTitleRegistry() {
  return React.useContext(EditorHeaderTitleContext);
}
