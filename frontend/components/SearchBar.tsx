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

  const borderColor = isFocused
    ? "var(--accent-primary)"
    : "var(--bg-border)";

  const boxShadow = isFocused
    ? "0 0 0 3px var(--highlight-glow)"
    : "none";

  return (
    <div
      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-md border transition-all duration-150 ${isLoading ? "shimmer-border" : ""}`}
      style={{
        background: "var(--bg-surface)",
        borderColor,
        boxShadow,
      }}
    >
      {/* Left icon */}
      <Search
        size={14}
        style={{ color: "var(--text-muted)", flexShrink: 0 }}
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
            background: "var(--bg-elevated)",
            borderColor: "var(--bg-border)",
            color: "var(--text-muted)",
          }}
        >
          ⌘K
        </kbd>
      ) : (
        <span
          className="text-[10px] font-mono shrink-0 animate-pulse"
          style={{ color: "var(--text-muted)" }}
        >
          thinking...
        </span>
      )}
    </div>
  );
}
