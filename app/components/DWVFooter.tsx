/**
 * Dog Walk Ventures — Shared Tool Footer
 * 
 * Drop this into any DWV tool to link back to the library.
 * Usage: <DWVFooter toolName="Your Tool Name" />
 * 
 * Supports both light and dark themes via the `dark` prop.
 * Dark theme (default): subtle white/10 border, white/40 text
 * Light theme: slate border, slate-500 text
 */

interface DWVFooterProps {
  toolName?: string;
  dark?: boolean;
}

export default function DWVFooter({ toolName, dark = true }: DWVFooterProps) {
  const textColor = dark ? "text-white/40" : "text-slate-400";
  const borderColor = dark ? "border-white/10" : "border-slate-200";
  const hoverColor = dark ? "hover:text-white/70" : "hover:text-slate-600";

  return (
    <footer className={`border-t ${borderColor} px-6 py-3 flex items-center justify-between text-xs ${textColor}`}>
      <div className="flex items-center gap-2">
        <span className="font-semibold tracking-tight">Dog Walk Ventures</span>
        {toolName && (
          <>
            <span className="opacity-30">·</span>
            <span>{toolName}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-4">
        <a
          href="https://dogwalkventures.com"
          target="_blank"
          rel="noopener noreferrer"
          className={`${hoverColor} transition-colors`}
        >
          More tools →
        </a>
        <a
          href="https://github.com/baktakt"
          target="_blank"
          rel="noopener noreferrer"
          className={`${hoverColor} transition-colors`}
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}