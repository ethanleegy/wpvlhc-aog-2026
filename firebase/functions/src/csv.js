function csvCell(value) {
  let text = String(value ?? "");
  // Neutralize spreadsheet formulas, including formulas hidden behind whitespace.
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function csv(headers, rows) {
  return (
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}
function guestCsv(report) {
  return csv(
    ["Name", "Church", "RSVP", "Invitation URL", "Responded at", "Plus one", "Plus-one name"],
    report.guests.map((guest) => [
      guest.name,
      guest.churchName,
      guest.rsvp,
      guest.uniqueUrl,
      guest.respondedAt,
      guest.plusOne === true ? "Yes" : "No",
      guest.plusOne === true ? guest.plusOneName : "",
    ]),
  );
}
function foodCsv(report) {
  return csv(
    ["Food item", "Quantity", "Unit", "Guest", "Church", "Notes"],
    report.contributions.map((item) => [
      item.foodName,
      item.quantity,
      item.unit,
      item.guestName,
      item.churchName,
      item.notes,
    ]),
  );
}
module.exports = { csvCell, guestCsv, foodCsv };
