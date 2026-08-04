"use client";
import { useState } from "react";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/countries";
import { composePhone } from "@/lib/phone";

export function PhoneInput({ onChange, id }: { onChange: (value: string) => void; id?: string }) {
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [national, setNational] = useState("");

  function emit(nextCountry: string, nextNational: string) {
    const dial = COUNTRIES.find((c) => c.code === nextCountry)?.dial ?? "";
    onChange(composePhone(dial, nextNational));
  }

  return (
    <div className="phone-input">
      <select
        className="select"
        aria-label="Country code"
        value={country}
        onChange={(e) => {
          setCountry(e.target.value);
          emit(e.target.value, national);
        }}
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>{c.flag} {c.dial}</option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        className="input"
        placeholder="532 123 45 67"
        value={national}
        onChange={(e) => {
          setNational(e.target.value);
          emit(country, e.target.value);
        }}
      />
    </div>
  );
}
