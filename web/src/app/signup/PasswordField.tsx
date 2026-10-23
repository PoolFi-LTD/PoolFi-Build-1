"use client";

import { useState } from "react";
import s from "./auth.module.css";

/** A password box with a Show/Hide button. */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span style={{ position: "relative", display: "block" }}>
        <input
          className="input"
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ paddingRight: 72 }}
        />
        <button
          type="button"
          className={s.link}
          onClick={() => setShown(!shown)}
          aria-label={shown ? "Hide password" : "Show password"}
          style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 13 }}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
