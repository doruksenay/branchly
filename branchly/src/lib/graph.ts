// Commit grafiği için şerit (lane) yerleşimi
import type { Commit } from "../api";

export type Edge = { fromLane: number; toLane: number; half: "top" | "bottom" | "full"; color: number };
export type GraphRow = { lane: number; color: number; edges: Edge[]; isMerge: boolean };

export function layoutGraph(commits: Commit[]): { rows: GraphRow[]; maxLanes: number } {
  const lanes: (string | null)[] = [];
  const laneColor: number[] = [];
  let colorSeq = 0;
  let maxLanes = 1;
  const rows: GraphRow[] = [];

  for (const c of commits) {
    const before = lanes.slice();
    const beforeColors = laneColor.slice();
    let idx = lanes.indexOf(c.hash);
    const isNewTip = idx === -1;
    if (isNewTip) {
      idx = lanes.indexOf(null);
      if (idx === -1) {
        idx = lanes.length;
        lanes.push(null);
      }
      laneColor[idx] = colorSeq++;
    }
    const color = laneColor[idx];
    const edges: Edge[] = [];

    // Üst yarı: bu commit'e gelen şeritler ve geçen şeritler
    before.forEach((h, j) => {
      if (h === null) return;
      if (h === c.hash) {
        edges.push({ fromLane: j, toLane: idx, half: "top", color: beforeColors[j] });
      }
    });
    // Bu commit'e yakınsayan diğer şeritleri kapat
    lanes.forEach((h, j) => {
      if (j !== idx && h === c.hash) lanes[j] = null;
    });

    // Ebeveynleri yerleştir
    const parents = c.parents;
    lanes[idx] = parents[0] ?? null;
    const bottomTargets: { lane: number; color: number }[] = [];
    if (parents[0]) bottomTargets.push({ lane: idx, color });
    for (let p = 1; p < parents.length; p++) {
      const ph = parents[p];
      let pl = lanes.indexOf(ph);
      if (pl === -1) {
        pl = lanes.indexOf(null);
        if (pl === -1) {
          pl = lanes.length;
          lanes.push(ph);
        } else lanes[pl] = ph;
        laneColor[pl] = colorSeq++;
      }
      bottomTargets.push({ lane: pl, color: laneColor[pl] });
    }
    for (const t of bottomTargets) edges.push({ fromLane: idx, toLane: t.lane, half: "bottom", color: t.color });

    // Geçen şeritler (commit'e dokunmayan)
    lanes.forEach((h, j) => {
      if (h === null || j === idx) return;
      if (before[j] === h) edges.push({ fromLane: j, toLane: j, half: "full", color: laneColor[j] });
    });

    // Sondaki boş şeritleri kırp
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    maxLanes = Math.max(maxLanes, before.length, lanes.length, idx + 1);
    rows.push({ lane: idx, color, edges, isMerge: parents.length > 1 });
  }
  return { rows, maxLanes };
}

export const LANE_COLORS = ["#0A64E8", "#D9730D", "#3E8E6A", "#8250DF", "#C2366B", "#0E8A9C", "#8A6D1F", "#5B6B8C"];
