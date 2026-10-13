import { expect, test, type Page } from "@playwright/test";
import { abrirConDiccionarios, ajustes, buscar } from "./utiles";

const SERVIDOR = "http://kotodex.test";

/** Un servidor de Anki falso: guarda lo que recibe y contesta como el de verdad. */
async function servidorFalso(page: Page) {
  const recibido = { notas: [] as { fields: Record<string, string>; deck: string }[], copias: [] as unknown[] };
  await page.route(`${SERVIDOR}/**`, async route => {
    const req = route.request();
    const ruta = new URL(req.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (ruta === "/health") return json({ status: "ok", notetype: "JP Dict", sync: false, autosync: {} });
    if (ruta === "/notes/check") return json({ results: [] });
    if (ruta === "/notes") {
      const nota = req.postDataJSON();
      // 今日 hace de palabra que ya está en la colección (el texto viene traducido; manda «code»).
      if (nota.fields.Expression === "今日" && !nota.allow_duplicate) return json({ detail: "既にあります", code: "duplicada" }, 409);
      recibido.notas.push(nota);
      return json({ note_id: 1, deck: "日本語", audio: null, duplicate: false, sync_in_seconds: 60 });
    }
    if (ruta === "/copia" && req.method() === "PUT") { recibido.copias.push(req.postDataJSON()); return json({ ok: true }); }
    if (ruta === "/copia") return recibido.copias.length ? json(recibido.copias.at(-1)) : json({ detail: "sin copias" }, 404);
    return json({ detail: "no simulado" }, 404);
  });
  return recibido;
}

test.beforeEach(async ({ page }) => {
  await ajustes(page, { mode: "server", serverUrl: SERVIDOR, serverToken: "token-de-prueba-muy-largo", decks: ["日本語"], lastDeck: "日本語" });
});

test("añadir desde una frase guarda la frase y sale en «Añadidas»", async ({ page }) => {
  const recibido = await servidorFalso(page);
  await abrirConDiccionarios(page);
  await buscar(page, "昨日<パン>を食べた。");
  await page.locator('.frase span[data-i="7"]').click();
  await expect(page.locator(".entry-word").first()).toHaveText("食べる");
  await page.getByRole("button", { name: "Añadir a Anki" }).first().click();
  await expect(page.locator(".added-note").first()).toContainText("con la frase");
  await expect(page.locator(".added-note").first()).toContainText("se sincroniza en 60 s");

  const nota = recibido.notas[0];
  expect(nota.fields.Expression).toBe("食べる");
  // Escapada y con la forma tocada en negrita.
  expect(nota.fields.Sentence).toBe("昨日&lt;パン&gt;を<b>食べた</b>。");

  await page.getByRole("button", { name: "Historial", exact: true }).click();
  await page.getByRole("tab", { name: /Añadidas a Anki \(1\)/ }).click();
  await expect(page.locator("main li").first()).toContainText("食べる");
});

test("sin frase no se manda Sentence", async ({ page }) => {
  const recibido = await servidorFalso(page);
  await abrirConDiccionarios(page);
  await buscar(page, "橋");
  await page.getByRole("button", { name: "Añadir a Anki" }).first().click();
  await expect(page.locator(".added-note").first()).toBeVisible();
  expect(recibido.notas[0].fields.Sentence).toBeUndefined();
});

test("copia de seguridad: automática al abrir, exportar y restaurar", async ({ page }) => {
  const recibido = await servidorFalso(page);
  await abrirConDiccionarios(page);
  await buscar(page, "橋");
  await expect(page.locator(".entry-word").first()).toHaveText("橋");
  // La automática sale al abrir la app.
  await expect.poll(() => recibido.copias.length).toBeGreaterThan(0);

  // Cerrar el teclado, como en el móvil: mientras se escribe, la barra de pestañas está escondida.
  await page.locator("input[type=search]").blur();
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  const descarga = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar archivo" }).click();
  const ruta = await (await descarga).path();
  const copia = JSON.parse(await (await import("node:fs/promises")).readFile(ruta, "utf8"));
  expect(copia.app).toBe("kotodex");
  expect(copia.ajustes.serverToken).toBeUndefined();
  expect(copia.historial.length).toBeGreaterThan(0);

  // Vaciar el historial y restaurar del archivo (restaurar pide confirmación).
  page.on("dialog", d => d.accept());
  await page.evaluate(() => new Promise<void>(ok => {
    const r = indexedDB.open("jp-dict");
    r.onsuccess = () => { const tx = r.result.transaction("lookups", "readwrite"); tx.objectStore("lookups").clear(); tx.oncomplete = () => { r.result.close(); ok(); }; };
  }));
  await page.locator('input[type=file][accept*=json]').setInputFiles(ruta);
  await expect(page.getByText(/Restaurado: [1-9]\d* del historial/)).toBeVisible();
});

test("historial: seleccionar varias y añadirlas de una vez", async ({ page }) => {
  const recibido = await servidorFalso(page);
  await abrirConDiccionarios(page);
  for (const [q, palabra] of [["橋", "橋"], ["今日", "今日"], ["食べた", "食べる"]]) {
    await buscar(page, q);
    await expect(page.locator(".entry-word").first()).toHaveText(palabra);
  }
  await page.locator("input[type=search]").blur();
  await page.getByRole("button", { name: "Historial", exact: true }).click();
  await page.getByRole("button", { name: "Seleccionar para añadir a Anki" }).click();
  await page.getByRole("button", { name: /Todas las no añadidas \(3\)/ }).click();
  // Quitar una a mano: 橋 no se añade.
  await page.locator(".history-item", { hasText: "橋" }).click();
  await page.getByRole("button", { name: "Añadir 2 a Anki" }).click();
  await expect(page.getByText("Añadidas 1. Ya estaban en Anki: 1.")).toBeVisible();
  expect(recibido.notas.map(n => n.fields.Expression)).toEqual(["食べる"]);
  // La que se añadió queda marcada «en Anki» en la lista.
  await expect(page.locator(".history-item", { hasText: "食べる" }).locator(".history-added")).toBeVisible();
});

test("«Añadir igualmente» sale con el error traducido (decide la clave, no el texto)", async ({ page }) => {
  await servidorFalso(page);
  await abrirConDiccionarios(page);
  await buscar(page, "今日");
  await expect(page.locator(".entry-word").first()).toHaveText("今日");
  // Cerrar el teclado antes de tocar abajo: con él abierto la barra de pestañas está escondida y
  // reaparecería encima del botón.
  await page.locator("input[type=search]").blur();
  await page.getByRole("button", { name: "Añadir a Anki" }).first().click();
  await expect(page.getByRole("button", { name: "Añadir igualmente" })).toBeVisible();
});
