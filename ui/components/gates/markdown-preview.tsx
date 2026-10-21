function markdownLines(text: string) {
  let code = false;
  return text.split("\n").map((line) => {
    if (line.startsWith("```")) {
      code = !code;
      return { line, code, fence: true };
    }
    return { line, code, fence: false };
  });
}
/** Small, safe read-only markdown preview; HTML and links remain literal text. */
export function MarkdownPreview({ text }: { text: string }) {
  return (
    <div
      className="space-y-2 rounded-lg border bg-muted/30 p-4"
      aria-label="Rendered preview"
    >
      {markdownLines(text).map(({ line, code, fence }, index) => {
        if (fence) return null;
        if (code)
          return (
            <pre key={index} className="overflow-x-auto text-sm">
              <code>{line || " "}</code>
            </pre>
          );
        if (line.startsWith("### "))
          return (
            <h4 key={index} className="font-semibold">
              {line.slice(4)}
            </h4>
          );
        if (line.startsWith("## "))
          return (
            <h3 key={index} className="text-lg font-semibold">
              {line.slice(3)}
            </h3>
          );
        if (line.startsWith("# "))
          return (
            <h2 key={index} className="text-xl font-semibold">
              {line.slice(2)}
            </h2>
          );
        if (/^[-*] /.test(line))
          return (
            <p key={index} className="pl-4">
              • {line.slice(2)}
            </p>
          );
        return (
          <p key={index} className="whitespace-pre-wrap break-words">
            {line || "\u00a0"}
          </p>
        );
      })}
    </div>
  );
}
