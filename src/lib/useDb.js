import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase';

/** Live subscription to a path. Pass enabled=false to skip the listener. */
export function useDb(path, enabled = true) {
  const [val, setVal] = useState(null);
  useEffect(() => {
    if (!enabled || !path) { setVal(null); return; }
    return onValue(ref(db, path), (s) => setVal(s.val()));
  }, [path, enabled]);
  return val;
}

/** Same, but keyed objects come back as an array with id folded in. */
export function useList(path, enabled = true) {
  const v = useDb(path, enabled);
  return Object.entries(v || {}).map(([id, o]) => ({ id, ...o }));
}
