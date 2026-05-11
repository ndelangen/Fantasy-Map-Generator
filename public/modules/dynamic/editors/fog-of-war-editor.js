"use strict";

/** Map customization mode id — keep unique vs other editors (battle-screen uses 13). */
const FOW_CUSTOMIZATION = 15;

let fowDraftPolygons = [];
let fowDraftMode = "obscured";
/** Active polygon index, or -1 when there are no polygons */
let fowActivePolyIndex = -1;

window.FogOfWarEditor = {open};

/** SVG path for draft polygon fill/stroke (smooth Bézier through vertices). */
function fowPolygonPathD(ring) {
  if (typeof ringToSmoothBezierPathD === "function") return ringToSmoothBezierPathD(ring);
  let d = `M${ring[0][0]},${ring[0][1]}`;
  for (let i = 1; i < ring.length; i++) d += `L${ring[i][0]},${ring[i][1]}`;
  return `${d}Z`;
}

function open() {
  if (customization) return tip("Please exit the current edit mode first", false, "error");
  closeDialogs("#fogOfWarEditor, .stable");
  insertEditorHtmlOnce();

  if (!layerIsOn("toggleFogOfWar")) toggleFogOfWar();

  $("#fogOfWarEditor").dialog({
    title: "Fog of war",
    resizable: false,
    position: {my: "right top", at: "right-10 top+10", of: "svg", collision: "fit"},
    close: () => {
      if (customization === FOW_CUSTOMIZATION) exitFowEditor(false);
    },
  });

  enterFowEditor();
}

function insertEditorHtmlOnce() {
  if (ensureEl("dialogs").querySelector("#fogOfWarEditor")) return;
  /* html */ const editorHtml = `<div id="fogOfWarEditor" class="dialog stable">
    <p style="margin: 0.4em 0">Polygons define <b>obscured</b> fog patches or <b>revealed</b> windows on a fully fogged map. Each polygon needs at least 3 vertices. <b>Add polygon</b> creates a triangle you can drag. Drag vertices; double-click a vertex to remove (if more than 3). Click gold (+) on an edge to insert a vertex.</p>
    <div style="margin: 0.5em 0">
      <label>Mode:
        <select id="fowModeSelect">
          <option value="obscured">Polygons = obscured</option>
          <option value="revealed">Polygons = revealed (inverse)</option>
        </select>
      </label>
    </div>
    <div style="margin: 0.5em 0">
      <div style="margin-bottom: 0.35em"><b>Polygons</b></div>
      <div id="fowPolyEmpty" style="margin: 0.25em 0; color: #666">No polygons yet. Use <b>Add polygon</b> to place a triangle (3 points).</div>
      <div id="fowPolyListWrap" style="display: none; max-height: 14em; overflow: auto; border: 1px solid #ccc; border-radius: 3px; margin-bottom: 0.45em">
        <table id="fowPolyTable" style="width: 100%; font-size: 0.92em; border-collapse: collapse">
          <thead><tr style="background: #f5f5f5"><th style="text-align:left;padding:4px 6px;width:2em">#</th><th style="text-align:left;padding:4px 6px">Id</th><th style="text-align:right;padding:4px 6px;width:5em">Vertices</th><th style="text-align:right;padding:4px 6px;width:10em">Actions</th></tr></thead>
          <tbody id="fowPolyListBody"></tbody>
        </table>
      </div>
      <button id="fowAddPoly" type="button">Add polygon</button>
      <button id="fowDelPoly" type="button">Remove selected</button>
    </div>
    <div style="margin-top: 0.9em">
      <button id="fowApply" data-tip="Save fog polygons to map" class="icon-check"></button>
      <button id="fowCancel" data-tip="Discard edits" class="icon-cancel"></button>
    </div>
  </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", editorHtml);

  ensureEl("fowModeSelect").addEventListener("change", () => {
    fowDraftMode = ensureEl("fowModeSelect").value === "revealed" ? "revealed" : "obscured";
    redrawFowEditorOverlay();
  });

  ensureEl("fowPolyListBody").addEventListener("click", e => {
    const sel = e.target.closest(".fowSelectPoly");
    const del = e.target.closest(".fowDelOnePoly");
    if (sel) {
      fowActivePolyIndex = +sel.dataset.i;
      syncPolyList();
      redrawFowEditorOverlay();
      return;
    }
    if (del) {
      const idx = +del.dataset.i;
      fowDraftPolygons.splice(idx, 1);
      if (fowActivePolyIndex >= fowDraftPolygons.length) fowActivePolyIndex = fowDraftPolygons.length - 1;
      syncPolyList();
      redrawFowEditorOverlay();
    }
  });

  ensureEl("fowAddPoly").addEventListener("click", () => {
    addTrianglePolygon(graphWidth * 0.5, graphHeight * 0.5);
    syncPolyList();
    redrawFowEditorOverlay();
  });
  ensureEl("fowDelPoly").addEventListener("click", () => {
    if (!fowDraftPolygons.length || fowActivePolyIndex < 0) return;
    fowDraftPolygons.splice(fowActivePolyIndex, 1);
    fowActivePolyIndex = fowDraftPolygons.length ? Math.min(fowActivePolyIndex, fowDraftPolygons.length - 1) : -1;
    syncPolyList();
    redrawFowEditorOverlay();
  });
  ensureEl("fowApply").addEventListener("click", applyFowEditor);
  ensureEl("fowCancel").addEventListener("click", () => $("#fogOfWarEditor").dialog("close"));
}

function syncPolyList() {
  const wrap = ensureEl("fowPolyListWrap");
  const emptyEl = ensureEl("fowPolyEmpty");
  const tbody = ensureEl("fowPolyListBody");

  tbody.innerHTML = "";
  if (!fowDraftPolygons.length) {
    wrap.style.display = "none";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";
  wrap.style.display = "block";

  fowDraftPolygons.forEach((p, i) => {
    const n = p.rings?.[0]?.length ?? 0;
    const shortId = String(p.id || "").length > 14 ? `${String(p.id).slice(0, 12)}…` : String(p.id || i);
    const tr = document.createElement("tr");
    tr.style.background = i === fowActivePolyIndex ? "#e8f0ff" : "";
    tr.innerHTML = `<td style="padding:4px 6px">${i + 1}</td><td style="padding:4px 6px;font-family:monospace;font-size:0.9em" title="${escapeHtml(
      String(p.id || ""),
    )}">${escapeHtml(shortId)}</td><td style="padding:4px 6px;text-align:right">${n}</td><td style="padding:4px 6px;text-align:right;white-space:nowrap">
      <button type="button" class="fowSelectPoly" data-i="${i}">Edit</button>
      <button type="button" class="fowDelOnePoly" data-i="${i}">Remove</button>
    </td>`;
    tbody.appendChild(tr);
  });
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function ensureFogPack() {
  if (!Array.isArray(pack.fogOfWarPolygons)) pack.fogOfWarPolygons = [];
  if (pack.fogOfWarMode !== "revealed") pack.fogOfWarMode = "obscured";
}

function enterFowEditor() {
  customization = FOW_CUSTOMIZATION;
  ensureFogPack();

  // Zoom calls drawFogOfWar often; set customization first so layers.js keeps #fogOfWar visible (not display:none).
  if (layerIsOn("toggleFogOfWar") && typeof drawFogOfWar === "function") drawFogOfWar();

  fowDraftPolygons = JSON.parse(JSON.stringify(pack.fogOfWarPolygons || []));
  fowDraftMode = pack.fogOfWarMode === "revealed" ? "revealed" : "obscured";
  ensureEl("fowModeSelect").value = fowDraftMode;

  fowActivePolyIndex = fowDraftPolygons.length ? 0 : -1;
  syncPolyList();

  fogOfWar.select("#fogOfWarEdit").remove();
  fogOfWar.append("g").attr("id", "fogOfWarEdit").attr("pointer-events", "visiblePainted");

  redrawFowEditorOverlay();
  tip("Add a polygon for a 3-point triangle, then drag vertices. Double-click a vertex to delete (if more than 3). Gold dots add vertices.", true);

  fogOfWar.select("#fogOfWarHit").style("pointer-events", "none");
  viewbox.style("cursor", "crosshair");

  if (layerIsOn("toggleFogOfWar") && typeof drawFogOfWar === "function") drawFogOfWar();
}

function addTrianglePolygon(cx, cy, r = Math.min(graphWidth, graphHeight) * 0.06) {
  const id = `fow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const pts = [];
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 - Math.PI / 2;
    pts.push([rn(cx + r * Math.cos(a), 2), rn(cy + r * Math.sin(a), 2)]);
  }
  fowDraftPolygons.push({id, rings: [pts]});
  fowActivePolyIndex = fowDraftPolygons.length - 1;
}

/** Full rebuild of edit overlay (safe when structure changes). Do not call on every drag tick. */
function redrawFowEditorOverlay() {
  const edit = fogOfWar.select("#fogOfWarEdit");
  if (!edit.size()) return;
  edit.selectAll("*").remove();

  fowDraftPolygons.forEach((poly, pi) => {
    const ring = poly.rings?.[0];
    if (!ring || ring.length < 3) return;

    const d = fowPolygonPathD(ring);

    const isActive = pi === fowActivePolyIndex;

    edit
      .append("path")
      .attr("class", "fow-edit-path")
      .attr("data-pi", pi)
      .attr("d", d)
      .attr("fill", isActive ? "rgba(80,160,255,0.14)" : "rgba(140,140,140,0.1)")
      .attr("stroke", isActive ? "#4080e8" : "#777")
      .attr("stroke-width", 1.4 / Math.max(scale, 0.001))
      .attr("pointer-events", "none");

    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const mx = (ring[i][0] + ring[j][0]) * 0.5;
      const my = (ring[i][1] + ring[j][1]) * 0.5;
      if (isActive) {
        edit
          .append("circle")
          .attr("class", "fow-edit-mid")
          .attr("data-pi", pi)
          .attr("data-edge", i)
          .attr("cx", mx)
          .attr("cy", my)
          .attr("r", 8 / Math.max(scale, 0.001))
          .attr("fill", "rgba(255,200,80,0.35)")
          .attr("stroke", "#c90")
          .attr("stroke-width", 1 / Math.max(scale, 0.001))
          .style("cursor", "copy")
          .attr("pointer-events", "visiblePainted")
          .on("click", () => {
            d3.event.stopPropagation();
            insertMidpoint(pi, i);
          });
      }
    }

    ring.forEach((pt, vi) => {
      if (!isActive) return;
      const node = edit
        .append("circle")
        .attr("class", "fow-edit-vert")
        .attr("data-pi", pi)
        .attr("data-vi", vi)
        .attr("cx", pt[0])
        .attr("cy", pt[1])
        .attr("r", 7 / Math.max(scale, 0.001))
        .attr("fill", "#fff")
        .attr("stroke", "#203050")
        .attr("stroke-width", 1.2 / Math.max(scale, 0.001))
        .style("cursor", "grab")
        .attr("pointer-events", "visiblePainted");

      node.call(
        d3
          .drag()
          .clickDistance(4)
          .container(() => viewbox.node())
          .on("drag", () => {
            const ring2 = fowDraftPolygons[pi].rings[0];
            ring2[vi][0] = rn(d3.event.x, 2);
            ring2[vi][1] = rn(d3.event.y, 2);
            refreshFowPolygonGeometry(edit, pi);
          }),
      );

      node.on("dblclick", () => {
        d3.event.stopPropagation();
        const ring2 = fowDraftPolygons[pi].rings[0];
        if (ring2.length <= 3) return tip("At least 3 vertices required", false, "warn");
        ring2.splice(vi, 1);
        redrawFowEditorOverlay();
      });
    });
  });
}

/** Update path + handles for one polygon without removing vertex nodes (keeps drag alive). */
function refreshFowPolygonGeometry(edit, pi) {
  const poly = fowDraftPolygons[pi];
  const ring = poly?.rings?.[0];
  if (!ring || ring.length < 3) return;

  const d = fowPolygonPathD(ring);

  edit.select(`.fow-edit-path[data-pi="${pi}"]`).attr("d", d);

  const n = ring.length;
  edit.selectAll(`.fow-edit-mid[data-pi="${pi}"]`).each(function () {
    const edge = +this.getAttribute("data-edge");
    const i = edge;
    const j = (i + 1) % n;
    const mx = (ring[i][0] + ring[j][0]) * 0.5;
    const my = (ring[i][1] + ring[j][1]) * 0.5;
    d3.select(this).attr("cx", mx).attr("cy", my);
  });

  edit.selectAll(`.fow-edit-vert[data-pi="${pi}"]`).each(function () {
    const vi = +this.getAttribute("data-vi");
    const pt = ring[vi];
    if (!pt) return;
    d3.select(this).attr("cx", pt[0]).attr("cy", pt[1]);
  });
}

function insertMidpoint(polyIndex, edgeStart) {
  const poly = fowDraftPolygons[polyIndex];
  const ring = poly.rings[0];
  const n = ring.length;
  const i = edgeStart;
  const j = (i + 1) % n;
  const mx = rn((ring[i][0] + ring[j][0]) * 0.5, 2);
  const my = rn((ring[i][1] + ring[j][1]) * 0.5, 2);
  const next = [];
  for (let k = 0; k < n; k++) {
    next.push([ring[k][0], ring[k][1]]);
    if (k === i) next.push([mx, my]);
  }
  poly.rings[0] = next;
  redrawFowEditorOverlay();
}

function applyFowEditor() {
  ensureFogPack();
  const valid = fowDraftPolygons.filter(p => Array.isArray(p.rings?.[0]) && p.rings[0].length >= 3);
  pack.fogOfWarPolygons = JSON.parse(JSON.stringify(valid));
  pack.fogOfWarMode = fowDraftMode;
  exitFowEditor(true);
  $("#fogOfWarEditor").dialog("close");
  drawFogOfWar();
  tip(valid.length ? "Fog of war saved" : "Fog of war cleared (no valid polygons)", false, "success");
}

function exitFowEditor(saved) {
  customization = 0;
  fogOfWar.select("#fogOfWarEdit").remove();
  fogOfWar.select("#fogOfWarHit").style("pointer-events", null);
  clearMainTip();
  viewbox.style("cursor", null);
  restoreDefaultEvents();
  if (!saved) drawFogOfWar();
}
