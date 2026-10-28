import React from "react";

interface AiMessageContentProps {
  text: string;
}

export default function AiMessageContent({ text }: AiMessageContentProps) {
  // 1. Sanitize text: remove HTML comments and leaked tool call JSON blobs
  let sanitized = text.replace(/<!--[\s\S]*?-->/g, "").trim();
  sanitized = sanitized.replace(/```(?:json)?\s*\{\s*(?:"name"|"tool_calls"|"tool"|"function")[\s\S]*?\}\s*```/gi, "");
  sanitized = sanitized.replace(/\{\s*"name"\s*:\s*"[a-zA-Z0-9_-]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/gi, "");

  const lines = sanitized.split("\n");
  const renderedElements: React.ReactNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line
    if (!trimmed) {
      renderedElements.push(<div key={`spacer-${i}`} className="h-2" />);
      i++;
      continue;
    }

    // Markdown Table detection: line starts and ends with '|'
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      if (/^\|[\s:-|-]+\|$/.test(nextLine)) {
        // Table header
        const headers = trimmed
          .slice(1, -1)
          .split("|")
          .map((h) => h.trim());
        const rows: string[][] = [];
        i += 2; // skip header and delimiter line

        while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
          const cells = lines[i]
            .trim()
            .slice(1, -1)
            .split("|")
            .map((c) => c.trim());
          rows.push(cells);
          i++;
        }

        renderedElements.push(
          <div key={`table-${i}`} className="my-3 overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/70 text-foreground font-semibold">
                <tr>
                  {headers.map((h, hIdx) => (
                    <th key={hIdx} className="px-3 py-2 border-b border-border/40">
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {rows.map((row, rIdx) => (
                  <tr key={rIdx} className={rIdx % 2 === 1 ? "bg-muted/30" : ""}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-3 py-1.5 text-foreground/90">
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        continue;
      }
    }

    // Headers
    if (trimmed.startsWith("#### ")) {
      renderedElements.push(
        <h5 key={`h4-${i}`} className="mt-2.5 mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {renderInline(trimmed.replace(/^####\s+/, ""))}
        </h5>,
      );
      i++;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      renderedElements.push(
        <h4 key={`h3-${i}`} className="mt-3 mb-1 text-sm font-bold text-foreground">
          {renderInline(trimmed.replace(/^###\s+/, ""))}
        </h4>,
      );
      i++;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      renderedElements.push(
        <h3 key={`h2-${i}`} className="mt-3 mb-1 text-base font-bold text-foreground">
          {renderInline(trimmed.replace(/^##\s+/, ""))}
        </h3>,
      );
      i++;
      continue;
    }

    if (trimmed.startsWith("# ")) {
      renderedElements.push(
        <h2 key={`h1-${i}`} className="mt-3 mb-1.5 text-lg font-bold text-foreground">
          {renderInline(trimmed.replace(/^#\s+/, ""))}
        </h2>,
      );
      i++;
      continue;
    }

    // Blockquote / Tip / Note
    if (trimmed.startsWith("> ")) {
      renderedElements.push(
        <div key={`quote-${i}`} className="my-1.5 border-l-2 border-primary/60 pl-3 italic text-foreground/80 text-xs">
          {renderInline(trimmed.replace(/^>\s+/, ""))}
        </div>,
      );
      i++;
      continue;
    }

    // Bullet List Item
    const isBullet = /^[-*•]\s+/.test(trimmed);
    const isNumbered = /^\d+\.\s+/.test(trimmed);

    if (isBullet || isNumbered) {
      const content = isBullet ? trimmed.replace(/^[-*•]\s+/, "") : trimmed.replace(/^\d+\.\s+/, "");
      renderedElements.push(
        <div key={`list-${i}`} className="flex items-start space-x-2 my-0.5 pl-1 leading-relaxed text-xs">
          <span className="text-primary font-bold select-none">{isBullet ? "•" : trimmed.match(/^\d+\./)?.[0]}</span>
          <span className="flex-1">{renderInline(content)}</span>
        </div>,
      );
      i++;
      continue;
    }

    // Normal paragraph line
    renderedElements.push(
      <div key={`line-${i}`} className="my-0.5 leading-relaxed text-xs">
        {renderInline(trimmed)}
      </div>,
    );
    i++;
  }

  return <div className="ai-message-content space-y-0.5">{renderedElements}</div>;
}

/**
 * Parses inline formatting: **bold**, *italic*, `code`
 */
function renderInline(text: string): React.ReactNode[] {
  // Tokenize bold, italic, code
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={index}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-primary"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      return (
        <em key={index} className="italic text-muted-foreground">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <span key={index}>{part}</span>;
  });
}
