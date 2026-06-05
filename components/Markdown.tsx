import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Shared renderer for AI-generated text (chat answers, insights, budget
 * summaries), which comes back as GitHub-flavored markdown. Styled with
 * Tailwind so it fits the app without pulling in the typography plugin.
 */
const components: Components = {
  p: (props) => <p className="mb-2 leading-relaxed last:mb-0" {...props} />,
  ul: (props) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0" {...props} />,
  ol: (props) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0" {...props} />,
  li: (props) => <li className="leading-relaxed" {...props} />,
  strong: (props) => <strong className="font-semibold" {...props} />,
  em: (props) => <em className="italic" {...props} />,
  h1: (props) => <h1 className="mb-2 mt-3 text-base font-semibold first:mt-0" {...props} />,
  h2: (props) => <h2 className="mb-2 mt-3 text-base font-semibold first:mt-0" {...props} />,
  h3: (props) => <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0" {...props} />,
  a: (props) => <a className="underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />,
  code: (props) => (
    <code className="rounded bg-black/10 px-1 py-0.5 text-[0.85em] dark:bg-white/10" {...props} />
  ),
  hr: (props) => <hr className="my-3 border-zinc-200 dark:border-zinc-800" {...props} />,
  blockquote: (props) => (
    <blockquote className="border-l-2 border-zinc-300 pl-3 italic dark:border-zinc-700" {...props} />
  ),
  table: (props) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left" {...props} />
    </div>
  ),
  th: (props) => (
    <th className="border-b border-zinc-300 px-2 py-1 font-semibold dark:border-zinc-700" {...props} />
  ),
  td: (props) => <td className="border-b border-zinc-200 px-2 py-1 dark:border-zinc-800" {...props} />,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
