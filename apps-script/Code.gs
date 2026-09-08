const SETTINGS = {
  bottlingSheet: '瓶詰め記録',
  incomingSheet: '入荷記録',
  masterSheet: '商品マスタ・在庫',
  firstDataRow: 4,
  historyDays: 2,
  maxHistoryItems: 200
};

function doGet() {
  return json_({ ok: true, service: 'bottle-record-tool-sheets' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    authorize_(payload.secret);
    lock.waitLock(30000);

    if (payload.type === 'history') return json_({ ok: true, items: history_(payload.kind) });
    if (payload.type === 'deleteHistory') {
      deleteHistory_(payload.kind, Number(payload.rowNumber));
      return json_({ ok: true });
    }
    if (payload.type === 'bottling' || payload.type === 'incoming') {
      appendReport_(payload);
      return json_({ ok: true });
    }
    throw new Error('Unsupported request type.');
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message || error) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function authorize_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET');
  if (!expected) throw new Error('SYNC_SECRET is not configured.');
  if (!provided || String(provided) !== expected) throw new Error('Unauthorized.');
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const spreadsheet = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Spreadsheet is not available.');
  return spreadsheet;
}

function sheetFor_(kind) {
  if (kind !== 'bottling' && kind !== 'incoming') throw new Error('Invalid record type.');
  const name = kind === 'bottling' ? SETTINGS.bottlingSheet : SETTINGS.incomingSheet;
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error(name + ' sheet was not found.');
  return sheet;
}

function appendReport_(payload) {
  const kind = payload.type;
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new Error('No record items.');
  const date = parseDate_(payload.date);
  const timestamp = new Date();
  const recorder = clean_(payload.recorderName);
  const notes = clean_(payload.notes);
  const supplier = clean_(payload.supplier);

  if (!recorder) throw new Error('Recorder name is required.');
  ensureMasterRows_(items);

  const rows = items.map(function(item) {
    const program = clean_(item.program);
    const wineName = clean_(item.wineName);
    const bottles = number_(item.bottles);
    if (kind === 'incoming') {
      return [timestamp, date, program, wineName, bottles, supplier, notes, recorder, clean_(item.itemNote)];
    }
    return [timestamp, date, program, wineName, bottles, number_(item.smallBottles), notes, recorder];
  });

  const sheet = sheetFor_(kind);
  const startRow = Math.max(sheet.getLastRow() + 1, SETTINGS.firstDataRow);
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(startRow, 1, rows.length, 1).setNumberFormat('yyyy/mm/dd hh:mm:ss');
  sheet.getRange(startRow, 2, rows.length, 1).setNumberFormat('yyyy/mm/dd');
}

function history_(kind) {
  const sheet = sheetFor_(kind);
  const lastRow = sheet.getLastRow();
  if (lastRow < SETTINGS.firstDataRow) return [];

  const width = kind === 'incoming' ? 9 : 8;
  const values = sheet.getRange(SETTINGS.firstDataRow, 1, lastRow - SETTINGS.firstDataRow + 1, width).getValues();
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (SETTINGS.historyDays - 1));

  return values.map(function(row, index) {
    const recordDate = asDate_(row[1]);
    if (!recordDate || recordDate < cutoff) return null;
    const common = {
      rowNumber: SETTINGS.firstDataRow + index,
      date: Utilities.formatDate(recordDate, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd'),
      program: clean_(row[2]),
      wineName: clean_(row[3]),
      bottles: number_(row[4]),
      notes: clean_(row[6]),
      recorderName: clean_(row[7])
    };
    if (kind === 'incoming') {
      common.supplier = clean_(row[5]);
      common.itemNote = clean_(row[8]);
    } else {
      common.smallBottles = number_(row[5]);
    }
    return common;
  }).filter(function(item) {
    return item !== null;
  }).reverse().slice(0, SETTINGS.maxHistoryItems);
}

function deleteHistory_(kind, rowNumber) {
  const sheet = sheetFor_(kind);
  if (!Number.isInteger(rowNumber) || rowNumber < SETTINGS.firstDataRow || rowNumber > sheet.getLastRow()) {
    throw new Error('Invalid row number.');
  }
  sheet.deleteRow(rowNumber);
}

function ensureMasterRows_(items) {
  const sheet = spreadsheet_().getSheetByName(SETTINGS.masterSheet);
  if (!sheet) throw new Error(SETTINGS.masterSheet + ' sheet was not found.');
  const lastRow = sheet.getLastRow();
  const existing = lastRow >= SETTINGS.firstDataRow
    ? sheet.getRange(SETTINGS.firstDataRow, 1, lastRow - SETTINGS.firstDataRow + 1, 1).getDisplayValues().map(function(row) { return row[0]; })
    : [];
  const known = {};
  existing.forEach(function(program) { if (program) known[program] = true; });

  items.forEach(function(item) {
    const program = clean_(item.program);
    if (!program || known[program]) return;
    const row = Math.max(sheet.getLastRow() + 1, SETTINGS.firstDataRow);
    sheet.getRange(row, 1, 1, 6).setValues([[
      program,
      clean_(item.wineName),
      0,
      "=SUMIF('入荷記録'!$C$4:$C$1000,A" + row + ",'入荷記録'!$E$4:$E$1000)",
      "=SUMIF('瓶詰め記録'!$C$4:$C$1000,A" + row + ",'瓶詰め記録'!$E$4:$E$1000)",
      '=C' + row + '+D' + row + '-E' + row
    ]]);
    known[program] = true;
  });
}

function parseDate_(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) throw new Error('Invalid date.');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    throw new Error('Invalid date.');
  }
  return date;
}

function asDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function clean_(value) {
  return value == null ? '' : String(value).trim();
}

function number_(value) {
  const result = Number(value);
  return isFinite(result) ? result : 0;
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
