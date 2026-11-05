import { useCallback, useMemo, useState } from 'react';
import type { DiagramDoc } from './types';

type HistoryState = {
  past: DiagramDoc[];
  present: DiagramDoc | null;
  future: DiagramDoc[];
};

const LIMIT = 60;

export function useDocHistory(initial: DiagramDoc | null = null, options: { locked?: boolean } = {}) {
  const locked = options.locked === true;
  const [state, setState] = useState<HistoryState>({ past: [], present: initial, future: [] });

  const commit = useCallback(
    (next: DiagramDoc | ((current: DiagramDoc) => DiagramDoc)) => {
      if (locked) return;
      setState((current) => {
        if (!current.present) return current;
        const value = typeof next === 'function' ? next(current.present) : next;
        if (value === current.present) return current;
        return { past: [...current.past, current.present].slice(-LIMIT), present: value, future: [] };
      });
    },
    [locked],
  );

  const replace = useCallback((next: DiagramDoc | ((current: DiagramDoc) => DiagramDoc)) => {
    setState((current) => {
      if (!current.present) return current;
      const value = typeof next === 'function' ? next(current.present) : next;
      return value === current.present ? current : { ...current, present: value };
    });
  }, []);

  const reset = useCallback((doc: DiagramDoc | null) => {
    setState({ past: [], present: doc, future: [] });
  }, []);

  const checkpoint = useCallback(() => {
    if (locked) return;
    setState((current) =>
      current.present
        ? { past: [...current.past, current.present].slice(-LIMIT), present: current.present, future: [] }
        : current,
    );
  }, [locked]);

  const undo = useCallback(() => {
    if (locked) return;
    setState((current) => {
      if (!current.present) return current;
      let past = current.past;
      while (past.length > 0 && past[past.length - 1] === current.present) past = past.slice(0, -1);
      if (past.length === 0) return current;
      const previous = past[past.length - 1];
      return {
        past: past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(0, LIMIT),
      };
    });
  }, [locked]);

  const redo = useCallback(() => {
    if (locked) return;
    setState((current) => {
      if (current.future.length === 0 || !current.present) return current;
      const next = current.future[0];
      return {
        past: [...current.past, current.present].slice(-LIMIT),
        present: next,
        future: current.future.slice(1),
      };
    });
  }, [locked]);

  return useMemo(
    () => ({
      doc: state.present,
      commit,
      replace,
      reset,
      checkpoint,
      undo,
      redo,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
    }),
    [state, commit, replace, reset, checkpoint, undo, redo],
  );
}

export type DocHistory = ReturnType<typeof useDocHistory>;
