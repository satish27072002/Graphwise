"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Search } from "lucide-react";

const PLACEHOLDER_CYCLE = [
  "Ask anything about your codebase...",
  "How does authentication work?",
  "What calls process_payment()?",
  "What breaks if I change User.save()?",
];

interface SearchBarProps {
  onSubmit: (question: string) => void;
  isLoading?: boolean;
  defaultValue?: string;
  placeholder?: string;
}

export function SearchBar({ onSubmit, isLoading, defaultValue, placeholder }: SearchBarProps) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Expose the input via DOM id for ⌘K focus
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.id = "search-input";
    }
  }, []);

  // Cycle placeholder text when the bar is empty and unfocused
  useEffect(() => {
    if (value || isFocused) return;
    const id = setInterval(() => {
      setPlaceholderIdx(i => (i + 1) % PLACEHOLDER_CYCLE.length);
    }, 3000);
    return () => clearInterval(id);
  }, [value, isFocused]);

  // Keep value in sync when defaultValue changes (e.g. after query)
  useEffect(() => {
    if (defaultValue !== undefined) {
      setValue(defaultValue);
    }
  }, [defaultValue]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && value.trim()) {
      onSubmit(value.trim());
    }
    if (e.key === "Escape") {
      inputRef.current?.blur();
    }
  };

  // Premium focus styles
  const borderColor = isFocused
    ? "var(--accent-primary)"
    : "var(--bg-border)";

  const boxShadow = isFocused
    ? "0 0 0 1px var(--accent-primary), 0 0 16px rgba(59,130,246,0.15), 0 1px 3px rgba(0,0,0,0.4)"
    : "0 1px 3px rgba(0,0,0,0.3)";

  const background = isFocused ? "var(--bg-elevated)" : "var(--bg-surface)";

  return (
    <div
      className={`w-full flex items-center gap-3 rounded-md border ${isLoading ? "shimmer-border" : ""}`}
      style={{
        padding: "10px 16px",
        background,
        borderColor,
        boxShadow,
        transition: "border-color 150ms ease, box-shadow 150ms ease, background 150ms ease",
      }}
    >
      {/* Left icon */}
      <Search
        size={14}
        style={{
          color: isFocused ? "var(--accent-primary)" : "var(--text-muted)",
          flexShrink: 0,
          transition: "color 150ms ease",
        }}
      />

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder ?? PLACEHOLDER_CYCLE[placeholderIdx]}
        disabled={isLoading}
        className="flex-1 bg-transparent outline-none font-mono text-sm min-w-0"
        style={{ color: "var(--text-primary)" }}
        autoComplete="off"
        spellCheck={false}
      />

      {/* Right: ⌘K badge or loading indicator */}
      {!isLoading ? (
        <kbd
          className="text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0"
          style={{
            background: "var(--bg-base)",
            borderColor: "var(--bg-border)",
            color: "var(--text-muted)",
            letterSpacing: "0.02em",
          }}
        >
          ⌘K
        </kbd>
      ) : (
        <span
          className="text-[10px] font-mono shrink-0 animate-pulse"
          style={{ color: "var(--accent-primary)" }}
        >
          thinking...
        </span>
      )}
    </div>
  );
}
