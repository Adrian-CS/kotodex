import { expect, test } from "@playwright/test";
import { abrirConDiccionarios, buscar } from "./utiles";

test.beforeEach(async ({ page }) => { await abrirConDiccionarios(page); });

test("はし sale ordenado por frecuencia: 橋, 端, 箸", async ({ page }) => {
  await buscar(page, "はし");
  await expect(page.locator(".entry-word")).toHaveText(["橋", "端", "箸"]);
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
