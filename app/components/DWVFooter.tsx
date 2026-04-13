/**
 * Dog Walk Ventures — Shared Tool Footer
 * 
 * Drop this into any DWV tool to link back to the library.
 * Usage: <DWVFooter toolName="Your Tool Name" />
 * 
 * Supports both light and dark themes via the `dark` prop.
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
    <footer className={`border-t ${borderColor} px-6 py-3 flex items-center text-xs ${textColor}`}>
      <a
        href="https://dog-walk-ventures.vercel.app"
        target="_blank"
        rel="noopener noreferrer"
        className={`font-semibold tracking-tight ${hoverColor} transition-colors`}
      >
        Dog Walk Ventures
      </a>
      {toolName && (
        <>
          <span className="opacity-30 mx-2">·</span>
          <span>{toolName}</span>
        </>
      )}
    </footer>
  );
}