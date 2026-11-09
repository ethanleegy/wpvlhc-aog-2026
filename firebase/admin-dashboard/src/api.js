export async function api(
  path,
  { method = "GET", body, download = false } = {},
) {
  const response = await fetch(`/v1/admin${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-Admin-Request": "true" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(
      data.error?.message || "The request could not be completed.",
    );
    error.status = response.status;
    error.code = data.error?.code;
    if (response.status === 401 && path !== "/login")
      window.dispatchEvent(new Event("session-expired"));
    throw error;
  }
  if (download) return response.blob();
  return response.status === 204 ? null : response.json();
}
export async function allGuests(churchId) {
  const guests = [];
  let cursor = null;
  do {
    const page = await api(
      `/guests?limit=100${churchId ? `&churchId=${encodeURIComponent(churchId)}` : ""}${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,
    );
    guests.push(...page.guests);
    cursor = page.nextCursor;
  } while (cursor);
  return guests.sort((a, b) => a.name.localeCompare(b.name));
}
export async function downloadReport(kind, churchId) {
  const blob = await api(
    `/reports/${kind}.csv${churchId ? `?churchId=${encodeURIComponent(churchId)}` : ""}`,
    { download: true },
  );
  saveDownload(blob, `christmas-social-${kind}.csv`);
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function downloadCsv(filename, headers, rows) {
  const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  saveDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}
function saveDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
