import * as XLSX from 'xlsx';

// Read an uploaded patient/tour file and return its content as CSV text, so
// the existing CSV parsers can consume .csv, .xlsx and .xls uniformly.
// For a spreadsheet, the first sheet is used and numbers are kept raw
// (unformatted) so coordinates and durations are not rounded by cell styles.
export async function fileToCSV(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const sheet = sheetName && wb.Sheets[sheetName];
    if (!sheet) throw new Error('The spreadsheet has no readable sheet.');
    return XLSX.utils.sheet_to_csv(sheet, { rawNumbers: true });
  }
  return file.text();
}
