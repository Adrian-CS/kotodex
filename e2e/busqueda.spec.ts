import { expect, test } from "@playwright/test";
import { abrirConDiccionarios, buscar } from "./utiles";

test.beforeEach(async ({ page }, info) => {
  // La de la lista de reserva importa un diccionario más: lo hace ella.
  if (!info.title.includes("reserva")) await abrirConDiccionarios(page);
});

test("はし sale ordenado por frecuencia: 橋, 端, 箸 y 嘴 (sin frecuencia) al final", async ({ page }) => {
  await buscar(page, "はし");
  await expect(page.locator(".entry-word")).toHaveText(["橋", "端", "箸", "嘴"]);
});

test("lista de frecuencia de reserva: cubre lo que falta en la principal, sin pisarla", async ({ page }) => {
  await abrirConDiccionarios(page, ["freq2"]);
  await buscar(page, "はし");
  // 嘴 sale de la reserva (2800); 箸 sigue con la principal (3000), aunque la reserva diga 10.
  await expect(page.locator(".entry-word")).toHaveText(["橋", "端", "嘴", "箸"]);
  await expect(page.locator(".entry").nth(2).locator(".entry-freq")).toContainText("Frecuencias de reserva (test)");
  await expect(page.locator(".entry").nth(3).locator(".entry-freq")).toContainText("3000");
});

test("con el teclado abierto en el móvil, la barra de pestañas se esconde", async ({ page }) => {
  const pestanas = page.locator("nav.tabs");
  await expect(pestanas).toBeVisible();
  await page.locator("input[type=search]").focus();
  await expect(pestanas).toBeHidden();
  await page.locator("input[type=search]").blur();
  await expect(pestanas).toBeVisible();
});

test("今日 trae dos acentos y la sección en español", async ({ page }) => {
  await buscar(page, "今日");
  const ficha = page.locator(".entry").first();
  await expect(ficha.locator(".entry-word")).toHaveText("今日");
  await expect(ficha.locator("svg.pitch")).toHaveCount(2);
  await expect(ficha.locator(".defs-es")).toContainText("hoy");
});

const CONJUGADAS: [string, string][] = [
  ["食べた", "食べる"],
  ["食べさせられた", "食べる"],
  ["たべている", "食べる"],
  ["読まなかった", "読む"],
  ["高くない", "高い"],
  ["勉強しました", "勉強"],
];
for (const [forma, base] of CONJUGADAS) {
  test(`${forma} cae en ${base} con la razón`, async ({ page }) => {
    await buscar(page, forma);
    const ficha = page.locator(".entry").first();
    await expect(ficha.locator(".entry-word")).toHaveText(base);
    await expect(ficha.locator(".entry-inflected")).toContainText(forma);
  });
}

test("rōmaji: taberu y kyou", async ({ page }) => {
  await buscar(page, "taberu");
  await expect(page.locator(".entry-word").first()).toHaveText("食べる");
  await buscar(page, "kyou");
  await expect(page.locator(".entry-word").first()).toHaveText("今日");
});

test("tocar 食 abre su ficha de kanji", async ({ page }) => {
  await buscar(page, "食べる");
  await page.getByRole("button", { name: /食/ }).first().click();
  const hoja = page.locator("dialog.hoja-kanji[open]");
  await expect(hoja).toContainText("ショク");
  await expect(hoja).toContainText("9 trazos");
  await expect(hoja.locator(".hoja-palabras")).toContainText("食べる");
});

test("frase pegada: tocar una palabra la busca", async ({ page }) => {
  await buscar(page, "昨日パンを食べた。");
  await page.locator('.frase span[data-i="5"]').click();
  await expect(page.locator(".frase .en-foco")).toHaveText(["食", "べ", "た"]);
  await expect(page.locator(".entry-word").first()).toHaveText("食べる");
});

/** Coordenadas del centro del carácter `c` dentro del primer elemento que case con `selector`. */
async function centroDe(page: import("@playwright/test").Page, selector: string, c: string) {
  return page.evaluate(([sel, car]) => {
    const raiz = document.querySelector(sel)!;
    const andador = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    for (let n = andador.nextNode() as Text | null; n; n = andador.nextNode() as Text | null) {
      const i = n.data.indexOf(car);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + 1);
      const caja = r.getBoundingClientRect();
      return { x: caja.left + caja.width * 0.75, y: caja.top + caja.height / 2 };
    }
    throw new Error(`no está ${car}`);
  }, [selector, c] as const);
}

test("tocar una palabra en la definición abre su ficha encima, y se puede apilar", async ({ page }) => {
  await buscar(page, "箸");
  const def = ".entry .defs-ja .def-html";
  await expect(page.locator(def).first()).toContainText("食べ物");
  // Mitad derecha del carácter a propósito: el caret cae detrás y hay que corregirlo.
  const p = await centroDe(page, def, "食");
  await page.mouse.click(p.x, p.y);
  const hoja = page.locator("dialog.hoja-ficha[open]");
  await expect(hoja.locator(".entry-word").first()).toHaveText("食べる");
  // Dentro de la hoja también se toca: la definición monolingüe de 食べる lleva 口.
  const q = await centroDe(page, "dialog.hoja-ficha[open] .defs-ja .def-html", "口");
  await page.mouse.click(q.x, q.y);
  // 口 no está en los diccionarios de prueba: no se abre nada y la hoja sigue en 食べる.
  await expect(hoja.locator(".entry-word").first()).toHaveText("食べる");
  await hoja.getByRole("button", { name: "Buscar aquí" }).click();
  await expect(page.locator("input[type=search]")).toHaveValue("食べる");
  await expect(hoja).toHaveCount(0);
});
