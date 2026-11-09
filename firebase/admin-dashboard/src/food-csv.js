export const MAX_IMPORT_ROWS = 2000;
export const MAX_CSV_BYTES = 8_000_000;

export function foodImportBatches(items) {
  const batches = [], encoder = new TextEncoder();
  let batch = { requestId: crypto.randomUUID(), items: [] };
  for (const item of items) {
    const candidate = { ...batch, items: [...batch.items, item] };
    if (batch.items.length && (batch.items.length === 10 || encoder.encode(JSON.stringify(candidate)).length > 30_000)) {
      batches.push(batch); batch = { requestId: crypto.randomUUID(), items: [] };
    }
    batch.items.push(item);
  }
  if (batch.items.length) batches.push(batch);
  return batches;
}

export function parseFoodCsv(text) {
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) throw new Error("Choose a CSV smaller than 8 MB.");
  text = text.replace(/^\uFEFF/, "");
  const records = [];
  let cells = [], field = "", state = "start", line = 1, startLine = 1;
  function finishField() { cells.push(field); field = ""; state = "start"; }
  function finishRow() {
    finishField();
    if (cells.some((cell) => cell.trim())) records.push({ cells, line: startLine });
    cells = [];
    if (records.length > MAX_IMPORT_ROWS + 1) throw new Error(`Import at most ${MAX_IMPORT_ROWS.toLocaleString()} food rows at once.`);
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === "quoted") {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else state = "closed";
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && text[i + 1] === "\n") i++;
        field += "\n"; line++;
      } else field += char;
    } else if (char === ",") finishField();
    else if (char === "\r" || char === "\n") {
      finishRow();
      if (char === "\r" && text[i + 1] === "\n") i++;
      line++; startLine = line;
    } else if (char === '"' && state === "start") state = "quoted";
    else if (char === '"' || (state === "closed" && !/[ \t]/.test(char))) throw new Error(`CSV line ${line}: check the quotation marks.`);
    else if (state !== "closed") { field += char; state = "plain"; }
  }
  if (state === "quoted") throw new Error(`CSV line ${startLine}: a quoted value was not closed.`);
  finishRow();
  if (records.length < 2) throw new Error("Include a header row and at least one food item.");
  const aliases = { name: "name", item: "name", unit: "unit", description: "description", active: "active", status: "status", "#": "ignore" };
  const headers = records.shift().cells.map((cell) => aliases[cell.trim().toLowerCase()]);
  if (headers.some((header) => !header)) throw new Error("Use Name, Unit, Description and Active headers, or the exported food-list headers.");
  if (new Set(headers).size !== headers.length) throw new Error("CSV column headers must be unique.");
  if (!headers.includes("name") || !headers.includes("unit")) throw new Error("Name (or Item) and Unit columns are required.");
  if (headers.includes("active") && headers.includes("status")) throw new Error("Use either Active or Status, not both.");
  return records.map((record) => {
    if (record.cells.length !== headers.length) throw new Error(`CSV line ${record.line}: expected ${headers.length} columns.`);
    const row = Object.fromEntries(headers.map((header, index) => [header, record.cells[index].trim()]));
    for (const [key, max] of [["name", 160], ["unit", 40], ["description", 500]]) {
      if ((key !== "description" && !row[key]) || (row[key] || "").length > max)
        throw new Error(`CSV line ${record.line}: ${key} must ${key === "description" ? `be at most ${max} characters` : `contain 1–${max} characters`}.`);
    }
    let active = true;
    if (row.active) {
      const value = row.active.toLowerCase();
      if (!["true", "false", "yes", "no", "1", "0"].includes(value)) throw new Error(`CSV line ${record.line}: Active must be true or false.`);
      active = ["true", "yes", "1"].includes(value);
    }
    if (row.status) {
      const value = row.status.toLowerCase();
      if (!["available", "taken", "inactive"].includes(value)) throw new Error(`CSV line ${record.line}: Status must be Available, Taken or Inactive.`);
      active = value !== "inactive";
    }
    return { name: row.name, unit: row.unit, description: row.description || "", active };
  });
}
