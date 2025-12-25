cat > src/core/api.js <<'JS'
export async function apiGet(path) {
  const res = await fetch(path, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

export async function apiUploadFile({ module, file, item_id = null }) {
  const fd = new FormData();
  fd.append("module", module);
  if (item_id) fd.append("item_id", item_id);
  fd.append("file", file);

  const res = await fetch("/api/v1/uploads", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`UPLOAD -> ${res.status}`);
  return res.json();
}

export async function apiListUploads({ module, item_id = null }) {
  const qs = new URLSearchParams();
  if (module) qs.set("module", module);
  if (item_id) qs.set("item_id", item_id);
  return apiGet(`/api/v1/uploads?${qs.toString()}`);
}

export async function apiDeleteUpload(id) {
  const res = await fetch(`/api/v1/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE upload ${id} -> ${res.status}`);
  return res.json();
}
JS
