import { expect, type Page } from "@playwright/test";

export const DICCIONARIOS = ["jmdict_en", "jmdict_es", "mono", "pitch", "kanji", "freq"].map(n => `test-dicts/${n}.zip`);

/** Ajustes iniciales (localStorage) antes de abrir la app. */
export async function ajustes(page: Page, s: Record<string, unknown>) {
  await page.addInitScript(valor => {
    if (!localStorage.getItem("jp-dict-settings")) localStorage.setItem("jp-dict-settings", valor);
  }, JSON.stringify(s));
}

/** Abre la app, importa los diccionarios de prueba y vuelve a la búsqueda. */
export async function abrirConDiccionarios(page: Page) {
  // KanjiVG se pide a GitHub: en las pruebas no se sale a la red.
  await page.route("https://raw.githubusercontent.com/**", r => r.fulfill({ status: 404 }));
  await page.goto("/");
  await page.getByRole("button", { name: "Diccionarios", exact: true }).click();
  await page.locator('input[type=file][accept*=zip]').setInputFiles(DICCIONARIOS);
  await expect(page.locator(".dict-item")).toHaveCount(DICCIONARIOS.length, { timeout: 30_000 });
  await expect(page.getByText("Importar .zip")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
}

export async function buscar(page: Page, q: string) {
  await page.locator("input[type=search]").fill(q);
}
