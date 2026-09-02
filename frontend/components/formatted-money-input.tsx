"use client";

import { useState } from "react";

const VND_FORMATTER = new Intl.NumberFormat("vi-VN");

function formatInputValue(value: string | number | undefined): string {
  if (value === undefined || String(value) === "") return "";
  const parsed = Number.parseInt(String(value).replace(/\D/g, ""), 10);
  return Number.isNaN(parsed) ? "" : VND_FORMATTER.format(parsed);
}

export default function FormattedMoneyInput({
  name,
  value,
  defaultValue,
  onChangeValue,
  placeholder,
  required,
  autoFocus,
}: {
  name?: string;
  value?: string | number;
  defaultValue?: string | number;
  onChangeValue?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const [display, setDisplay] = useState(() => formatInputValue(value ?? defaultValue));
  const visibleDisplay = value === undefined ? display : formatInputValue(value);

  function updateValue(inputValue: string) {
    const digitsOnly = inputValue.replace(/\D/g, "");
    if (!digitsOnly) {
      setDisplay("");
      onChangeValue?.("");
      return;
    }

    const parsed = Number.parseInt(digitsOnly, 10);
    if (Number.isNaN(parsed)) return;
    setDisplay(VND_FORMATTER.format(parsed));
    onChangeValue?.(String(parsed));
  }

  return (
    <div className="amount-input-wrapper">
      <input
        type="text"
        inputMode="numeric"
        value={visibleDisplay}
        onChange={(event) => updateValue(event.target.value)}
        onPaste={(event) => {
          event.preventDefault();
          updateValue(event.clipboardData.getData("text"));
        }}
        placeholder={placeholder ?? "0"}
        required={required}
        autoFocus={autoFocus}
      />
      <span className="amount-currency-badge">₫</span>
      {name && (
        <input
          name={name}
          type="hidden"
          value={visibleDisplay.replace(/\D/g, "")}
        />
      )}
    </div>
  );
}
