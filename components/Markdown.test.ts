import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

const render = (text: string) => renderToStaticMarkup(Markdown({ children: text }));

describe("Markdown", () => {
  it("renders the agent's formatting and tables", () => {
    const html = render("**Verdict**\n\n| A |\n|---|\n| 1 |");
    expect(html).toContain("<strong>Verdict</strong>");
    expect(html).toContain("<table");
  });

  it("never turns quoted web text into live markup", () => {
    const html = render('<img src=x onerror="alert(1)"><script>alert(1)</script>\n\n[x](javascript:alert(1))');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
  });
});
