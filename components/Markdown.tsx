import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  h1: (p) => <h3 className="mt-5 mb-2 text-base font-semibold first:mt-0" {...p} />,
  h2: (p) => <h4 className="mt-5 mb-2 text-sm font-semibold first:mt-0" {...p} />,
  h3: (p) => <h5 className="mt-4 mb-1 text-sm font-semibold first:mt-0" {...p} />,
  p: (p) => <p className="my-2 first:mt-0 last:mb-0" {...p} />,
  ul: (p) => <ul className="my-2 list-disc space-y-1 pl-5" {...p} />,
  ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />,
  a: (p) => <a className="underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
  code: (p) => <code className="rounded bg-zinc-100 px-1 py-0.5 text-[0.85em] dark:bg-zinc-800" {...p} />,
  table: (p) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left" {...p} />
    </div>
  ),
  th: (p) => <th className="border-b border-zinc-300 px-2 py-1 font-medium dark:border-zinc-700" {...p} />,
  td: (p) => <td className="border-b border-zinc-100 px-2 py-1 dark:border-zinc-800" {...p} />,
};

/**
 * Agent-written markdown. Raw HTML stays disabled (no rehype-raw): this text can
 * quote web pages, so it must never render as markup.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="break-words text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
