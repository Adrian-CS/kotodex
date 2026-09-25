// Convierte glosarios de Yomitan (texto o structured-content) en HTML seguro.
// El mismo HTML se usa en la app y en los campos de la tarjeta de Anki.

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const TAGS = new Set(["span", "div", "ol", "ul", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "ruby", "rt", "rp", "details", "summary"]);

const STYLE_KEYS: Record<string, string> = {
  fontWeight: "font-weight", fontStyle: "font-style", fontSize: "font-size",
  textDecorationLine: "text-decoration-line", verticalAlign: "vertical-align", textAlign: "text-align",
  marginTop: "margin-top", marginBottom: "margin-bottom", marginLeft: "margin-left", marginRight: "margin-right",
  paddingLeft: "padding-left", listStyleType: "list-style-type", whiteSpace: "white-space",
};
const SAFE_VALUE = /^[\w\s.%#(),"'-]+$/;
const SAFE_KEY = /^[A-Za-z0-9-]+$/;

function styleAttr(style: Record<string, unknown> | undefined): string {
  if (!style) return "";
  const css = Object.entries(style)
    .filter(([k]) => k in STYLE_KEYS)
    .map(([k, v]) => [STYLE_KEYS[k], typeof v === "number" ? `${v}em` : String(v)])
    .filter(([, v]) => SAFE_VALUE.test(v))
    .map(([k, v]) => `${k}:${v}`).join(";");
  return css ? ` style="${escapeHtml(css)}"` : "";
}

function renderNode(n: any): string {
  if (n == null) return "";
  if (typeof n === "string") return escapeHtml(n).replace(/\n/g, "<br>");
  if (Array.isArray(n)) return n.map(renderNode).join("");
  if (typeof n !== "object") return "";
  if (n.tag === "img") return "";            // imágenes: no soportadas por ahora
  if (n.tag === "br") return "<br>";
  const tag = TAGS.has(n.tag) ? n.tag : "span"; // <a> y desconocidos → span
  let attrs = styleAttr(n.style);
  if (n.data && typeof n.data === "object") {
    for (const [k, v] of Object.entries(n.data)) {
      if (SAFE_KEY.test(k)) attrs += ` data-sc-${k}="${escapeHtml(String(v))}"`;
    }
  }
  if (typeof n.lang === "string" && SAFE_KEY.test(n.lang)) attrs += ` lang="${n.lang}"`;
  if ((tag === "td" || tag === "th")) {
    if (Number.isInteger(n.colSpan)) attrs += ` colspan="${n.colSpan}"`;
    if (Number.isInteger(n.rowSpan)) attrs += ` rowspan="${n.rowSpan}"`;
  }
  return `<${tag}${attrs}>${renderNode(n.content)}</${tag}>`;
}

interface Item { html: string; plain: boolean }

/**
 * Texto suelto a HTML. Los saltos de linea cuentan: hay diccionarios (Naver KR-JP y muchos
 * monolingues) que separan los sentidos con \n dentro de una sola cadena de texto.
 * Sin convertirlos, la definicion sale como un muro ilegible.
 */
const plainHtml = (s: string) => escapeHtml(s).replace(/\n/g, "<br>");

function glossaryItem(g: any): Item | null {
  if (typeof g === "string") return { html: plainHtml(g), plain: true };
  if (g?.type === "text") return { html: plainHtml(String(g.text)), plain: true };
  if (g?.type === "structured-content") return { html: `<div class="sc">${renderNode(g.content)}</div>`, plain: false };
  return null; // imágenes, formas deflexionadas, etc.
}

/** Una lista de sentidos (una fila de term_bank = un sentido) → HTML. */
export function sensesHtml(senses: unknown[][]): string {
  const rendered = senses
    .map(gl => gl.map(glossaryItem).filter((i): i is Item => i !== null))
    .filter(items => items.length)
    .map(items => items.map(i => i.html).join(items.every(i => i.plain) ? "; " : ""));
  if (!rendered.length) return "";
  if (rendered.length === 1) return rendered[0];
  return `<ol>${rendered.map(s => `<li>${s}</li>`).join("")}</ol>`;
}
