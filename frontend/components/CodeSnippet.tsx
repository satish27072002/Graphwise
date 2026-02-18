"use client";

interface CodeSnippetProps {
  name: string;
  file: string;
  start_line: number;
  end_line: number;
  code: string;
  complexity?: number;
}

export function CodeSnippet({
  name,
  file,
  start_line,
  end_line,
  code,
  complexity,
}: CodeSnippetProps) {
  // Add line numbers to code
  const lines = code.split("\n");

  return (
    <div className="space-y-3">
      {/* Header metadata */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="font-mono text-sm font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            {name}
          </span>
          {complexity !== undefined && (
            <span
              className="font-mono text-[10px] px-2 py-0.5 rounded border"
              style={{
                background: "var(--bg-elevated)",
                borderColor: "var(--bg-border)",
                color: complexity > 10
                  ? "#ef4444"
                  : complexity > 5
                  ? "#f59e0b"
                  : "var(--text-muted)",
              }}
            >
              complexity: {complexity}
            </span>
          )}
        </div>
        <p className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
          {file} : {start_line}–{end_line}
        </p>
      </div>

      {/* Code block with line numbers */}
      <div
        className="rounded-md overflow-hidden border"
        style={{ borderColor: "var(--bg-border)" }}
      >
        <div
          className="flex overflow-x-auto"
          style={{ background: "var(--bg-base)", maxHeight: 400 }}
        >
          {/* Line numbers */}
          <div
            className="select-none text-right py-3 pr-3 pl-3 text-[11px] font-mono leading-5"
            style={{
              background: "var(--bg-surface)",
              color: "var(--text-muted)",
              borderRight: "1px solid var(--bg-border)",
              minWidth: 40,
            }}
          >
            {lines.map((_, i) => (
              <div key={i}>{start_line + i}</div>
            ))}
          </div>

          {/* Code */}
          <pre
            className="flex-1 text-[11px] font-mono leading-5 py-3 px-4 overflow-x-auto"
            style={{ color: "var(--text-primary)", background: "var(--bg-base)" }}
          >
            <code>{code}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
