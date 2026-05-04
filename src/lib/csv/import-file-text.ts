import * as XLSX from "xlsx";

export function isExcelLike(fileName: string, mimeType: string): boolean {
  const lower = fileName.toLowerCase();
  if (/\.(xlsx|xls|xlsm)$/i.test(lower)) {
    return true;
  }
  return (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.ms-excel.sheet.macroEnabled.12"
  );
}

/** Décodage CSV Disnat : UTF-8 strict, repli windows-1252 si besoin. */
export function decodeCsvBuffer(buffer: ArrayBuffer): string {
  let utf8Result = "";

  try {
    utf8Result = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }

  if (/\uFFFD/.test(utf8Result) || /Ct\b|Moy\b|march\b/.test(utf8Result)) {
    return new TextDecoder("windows-1252").decode(buffer);
  }

  return utf8Result;
}

/** Première feuille du classeur → texte délimité (séparateur `;`, aligné exports Excel fr-CA). */
export function workbookBufferToPlainText(buffer: ArrayBuffer): string {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch {
    throw new Error(
      "Impossible de lire ce fichier Excel (fichier corrompu ou format non supporté).",
    );
  }

  const firstName = workbook.SheetNames[0];
  if (!firstName) {
    throw new Error("Le fichier Excel ne contient aucune feuille.");
  }

  const sheet = workbook.Sheets[firstName];
  if (!sheet) {
    throw new Error("Feuille Excel introuvable.");
  }

  return XLSX.utils.sheet_to_csv(sheet, { FS: ";", blankrows: false });
}

export async function importFileToParseText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  if (isExcelLike(file.name, file.type)) {
    return workbookBufferToPlainText(buffer);
  }
  return decodeCsvBuffer(buffer);
}
