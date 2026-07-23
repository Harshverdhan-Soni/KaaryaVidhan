import { createContext, useContext, useEffect, useState } from 'react';
import { signInWithCustomToken, signOut, onAuthStateChanged, onIdTokenChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { ref, onValue } from 'firebase/database';
import { auth, fns, db } from './firebase';
import { registerPush, unregisterPush } from './notify';

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

  // Once we know who is signed in, quietly (re)claim this device's push token for
  // them. Silent mode never prompts, so a returning user's pushes resume with no
  // button press; it self-cancels if permission was never granted or push isn't
  // configured. Keyed on empId so it re-runs when a different person signs in.
  useEffect(() => {
    if (me?.empId) registerPush(me.empId, { silent: true });
  }, [me?.empId]);

  const login = async (empId, pin) => {
    const call = httpsCallable(fns, 'login');
    const { data } = await call({ empId: String(empId).trim(), pin: String(pin).trim() });
    await signInWithCustomToken(auth, data.token);
  };

  // Release this device's push token from the current user BEFORE signing out,
  // so the next person on a shared machine doesn't inherit their notifications.
  // unregisterPush never throws, but we still guard so nothing can stop sign-out.
  const logout = async () => {
    try { if (me?.empId) await unregisterPush(me.empId); }
    catch (e) { console.warn('push unregister skipped', e); }
    await signOut(auth);
  };

  return (
    <Ctx.Provider value={{ me, role, loading, login, logout }}>
      {children}
    </Ctx.Provider>
  );
}
