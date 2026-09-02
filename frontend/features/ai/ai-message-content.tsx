export default function AiMessageContent({ text }: { text: string }) {
  return (
    <div className="ai-message-content">
      {text.split("\n").map((line, index) => {
        if (!line.trim()) return <br key={index} />;
        const className = /^[-•*]\s|^\d+\.\s/.test(line)
          ? "ai-list-item"
          : undefined;
        return (
          <div key={index} className={className}>
            {renderInline(line)}
          </div>
        );
      })}
    </div>
  );
}

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}
