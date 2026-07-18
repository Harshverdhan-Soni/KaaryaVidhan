import { createContext, useContext, useEffect, useState } from 'react';
import { signInWithCustomToken, signOut, onAuthStateChanged, onIdTokenChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { ref, onValue } from 'firebase/database';
import { auth, fns, db } from './firebase';

const Ctx = createContext(null);
export const useAuthed = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [me, setMe]           = useState(null);   // employee record
  const [role, setRole]       = useState(null);   // 'admin' | 'manager' | 'employee'
  const [loading, setLoading] = useState(true);

  useEffect(() => onIdTokenChanged(auth, async (u) => {
    if (!u) { setMe(null); setRole(null); setLoading(false); return; }
    const t = await u.getIdTokenResult();
    setRole(t.claims.role || 'employee');
  }), []);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    if (!u) { setMe(null); setLoading(false); return; }
    const off = onValue(ref(db, `employees/${u.uid}`), (s) => {
      setMe(s.exists() ? { empId: u.uid, ...s.val() } : null);
      setLoading(false);
    });
    return off;
  }), []);

  const login = async (empId, pin) => {
    const call = httpsCallable(fns, 'login');
    const { data } = await call({ empId: String(empId).trim(), pin: String(pin).trim() });
    await signInWithCustomToken(auth, data.token);
  };

  return (
    <Ctx.Provider value={{ me, role, loading, login, logout: () => signOut(auth) }}>
      {children}
    </Ctx.Provider>
  );
}
