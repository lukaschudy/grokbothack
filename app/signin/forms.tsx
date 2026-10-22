"use client";

import { useActionState, useState } from "react";
import { signInAction, signUpAction } from "../actions";

export function SignInForms({ next }: { next: string }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [inState, signIn, signingIn] = useActionState(signInAction, null);
  const [upState, signUp, signingUp] = useActionState(signUpAction, null);
  return mode === "in" ? (
    <form action={signIn} className="stack">
      <input type="hidden" name="next" value={next} />
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      {inState?.error && <p className="notice bad" role="alert">{inState.error}</p>}
      <div className="venue-actions">
        <button className="button" disabled={signingIn}>{signingIn ? "Signing in…" : "Sign in"}</button>
        <button type="button" className="text-button" onClick={() => setMode("up")}>New here? Create an account</button>
      </div>
    </form>
  ) : (
    <form action={signUp} className="stack">
      <div className="row">
        <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" autoComplete="name" required /></div>
        <div className="field"><label htmlFor="community">Community you run (optional)</label><input id="community" name="community" placeholder="e.g. London AI Builders" /></div>
      </div>
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required /></div>
      <p className="hint">You can search and browse straight away. To post venues, a member who knows you needs to vouch for you.</p>
      {upState?.error && <p className="notice bad" role="alert">{upState.error}</p>}
      <div className="venue-actions">
        <button className="button" disabled={signingUp}>{signingUp ? "Creating…" : "Create account"}</button>
        <button type="button" className="text-button" onClick={() => setMode("in")}>Have an account? Sign in</button>
      </div>
    </form>
  );
}
