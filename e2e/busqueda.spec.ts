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
