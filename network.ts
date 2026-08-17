// Road network definition: nodes (intersections) + links (road segments).
// Coordinates are in metres on the XZ plane. -Z is "north".

export type NodeKind = 'signal' | 'stop' | 'plain' | 'roundabout' | 'lot';
export type LinkKind = 'main' | 'residential' | 'highway' | 'ramp' | 'lot';

export interface RNode {
  id: string;
  x: number;
  z: number;
  kind: NodeKind;
  /** paved radius of the junction pad */
  radius: number;
  links: string[];
  phase: number; // signal offset
}

export interface RLink {
  id: string;
  a: string;
  b: string;
  kind: LinkKind;
  lanes: number; // lanes per direction
  speed: number; // km/h limit
  // computed
  ax: number; az: number; bx: number; bz: number;
  dx: number; dz: number; // unit direction a->b
  len: number;
  half: number; // half road width
  axis: 'ns' | 'ew' | 'diag';
}

export const LANE_W = 3.5;

export function halfWidth(kind: LinkKind, lanes: number) {
  if (kind === 'residential') return 3.1 * lanes;
  if (kind === 'highway') return LANE_W * lanes + 1.2;
  if (kind === 'lot') return 3.4;
  return LANE_W * lanes;
}

export interface Network {
  nodes: Record<string, RNode>;
  links: RLink[];
  linkById: Record<string, RLink>;
  nodeList: RNode[];
}

const GX = [-120, -40, 40, 120];
const GZ = [-120, -40, 40, 120];

function nid(i: number, j: number) {
  return `g${i}${j}`;
}

export function buildNetwork(): Network {
  const nodes: Record<string, RNode> = {};
  const links: RLink[] = [];

  const addNode = (id: string, x: number, z: number, kind: NodeKind, radius = 8) => {
    nodes[id] = { id, x, z, kind, radius, links: [], phase: 0 };
    return nodes[id];
  };

  const addLink = (a: string, b: string, kind: LinkKind, lanes = 1, speed = 50) => {
    const na = nodes[a];
    const nb = nodes[b];
    const dx0 = nb.x - na.x;
    const dz0 = nb.z - na.z;
    const len = Math.hypot(dx0, dz0);
    const id = `${a}-${b}`;
    const axis: 'ns' | 'ew' | 'diag' =
      Math.abs(dx0) < 1 ? 'ns' : Math.abs(dz0) < 1 ? 'ew' : 'diag';
    const l: RLink = {
      id, a, b, kind, lanes, speed,
      ax: na.x, az: na.z, bx: nb.x, bz: nb.z,
      dx: dx0 / len, dz: dz0 / len, len,
      half: halfWidth(kind, lanes),
      axis,
    };
    links.push(l);
    na.links.push(id);
    nb.links.push(id);
    return l;
  };

  // ---- city / residential grid ------------------------------------------
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      // signals on the two central "main" crossings, stops elsewhere
      const isMainX = i === 1 || i === 2;
      const isMainZ = j === 1 || j === 2;
      let kind: NodeKind = 'stop';
      if (isMainX && isMainZ) kind = 'signal';
      const n = addNode(nid(i, j), GX[i], GZ[j], kind, kind === 'signal' ? 10 : 8);
      n.phase = ((i * 7 + j * 11) % 4) * 4;
    }
  }
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const mainRow = j === 1 || j === 2;
      const mainCol = i === 1 || i === 2;
      if (i < 3) addLink(nid(i, j), nid(i + 1, j), mainRow ? 'main' : 'residential', mainRow ? 2 : 1, mainRow ? 50 : 30);
      if (j < 3) addLink(nid(i, j), nid(i, j + 1), mainCol ? 'main' : 'residential', mainCol ? 2 : 1, mainCol ? 50 : 30);
    }
  }

  // ---- north avenue toward the roundabout --------------------------------
  addNode('r_s', 0, -200, 'plain', 7.2);
  addNode('rbt', 0, -260, 'roundabout', 20);
  addNode('r_w', -90, -260, 'plain', 7.2);
  addNode('r_e', 90, -260, 'plain', 7.2);
  addNode('h_on', 0, -320, 'plain', 7.2);

  addNode('av_w', -40, -160, 'stop', 8);
  addNode('av_e', 40, -160, 'stop', 8);
  addNode('av_c', 0, -160, 'signal', 10);
  nodes['av_c'].phase = 6;

  addLink('g11', 'av_w', 'main', 1, 50);
  addLink('g21', 'av_e', 'main', 1, 50);
  addLink('av_w', 'av_c', 'main', 1, 50);
  addLink('av_c', 'av_e', 'main', 1, 50);
  addLink('av_c', 'r_s', 'main', 1, 50);
  addLink('r_s', 'rbt', 'main', 1, 40);
  addLink('rbt', 'r_w', 'main', 1, 50);
  addLink('rbt', 'r_e', 'main', 1, 50);
  addLink('rbt', 'h_on', 'ramp', 1, 60);

  // ---- highway -----------------------------------------------------------
  addNode('h_w', -300, -380, 'plain', 9);
  addNode('h_c', 0, -380, 'plain', 9);
  addNode('h_e', 300, -380, 'plain', 9);
  addLink('h_on', 'h_c', 'ramp', 1, 60);
  addLink('h_w', 'h_c', 'highway', 2, 100);
  addLink('h_c', 'h_e', 'highway', 2, 100);

  // ---- parking area (east) ----------------------------------------------
  addNode('p_in', 200, 40, 'plain', 7);
  addNode('p_a', 200, -6, 'lot', 6);
  addNode('p_b', 200, 86, 'lot', 6);
  addLink('g31', 'p_in', 'main', 1, 40);
  addLink('p_in', 'p_a', 'lot', 1, 20);
  addLink('p_in', 'p_b', 'lot', 1, 20);

  // ---- residential cul-de-sacs (south) -----------------------------------
  addNode('res_a', -120, 190, 'plain', 6);
  addNode('res_b', 40, 190, 'plain', 6);
  addLink('g03', 'res_a', 'residential', 1, 30);
  addLink('g23', 'res_b', 'residential', 1, 30);
  addLink('res_a', 'res_b', 'residential', 1, 30);

  const linkById: Record<string, RLink> = {};
  for (const l of links) linkById[l.id] = l;

  return { nodes, links, linkById, nodeList: Object.values(nodes) };
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

/** signed lateral offset of point p from link centreline, positive to the right of a->b */
export function linkProjection(l: RLink, x: number, z: number) {
  const rx = x - l.ax;
  const rz = z - l.az;
  const t = rx * l.dx + rz * l.dz;
  // right vector of (dx,dz) is (-dz, dx)
  const lat = rx * -l.dz + rz * l.dx;
  return { t, lat };
}

export function laneOffset(l: RLink, laneIndex: number) {
  return l.half - LANE_W * (laneIndex + 0.5);
}

/** world position of a point travelling along link from `from` node at distance t in lane */
export function lanePoint(
  net: Network,
  l: RLink,
  fromA: boolean,
  t: number,
  laneIndex: number,
  out: { x: number; z: number; dx: number; dz: number },
) {
  const dx = fromA ? l.dx : -l.dx;
  const dz = fromA ? l.dz : -l.dz;
  const sx = fromA ? l.ax : l.bx;
  const sz = fromA ? l.az : l.bz;
  const off = laneOffset(l, laneIndex);
  // right vector
  const rx = -dz;
  const rz = dx;
  out.x = sx + dx * t + rx * off;
  out.z = sz + dz * t + rz * off;
  out.dx = dx;
  out.dz = dz;
  void net;
  return out;
}

export const SIGNAL_CYCLE = 30;
export type LightState = 'green' | 'yellow' | 'red';

/** traffic light state for an approach along a given axis */
export function signalState(node: RNode, axis: 'ns' | 'ew' | 'diag', time: number): LightState {
  const t = (time + node.phase) % SIGNAL_CYCLE;
  const nsGreen = t < 11;
  const nsYellow = t >= 11 && t < 14;
  const ewGreen = t >= 15 && t < 26;
  const ewYellow = t >= 26 && t < 29;
  if (axis === 'ns' || axis === 'diag') {
    if (nsGreen) return 'green';
    if (nsYellow) return 'yellow';
    return 'red';
  }
  if (ewGreen) return 'green';
  if (ewYellow) return 'yellow';
  return 'red';
}

export function otherEnd(l: RLink, nodeId: string) {
  return l.a === nodeId ? l.b : l.a;
}
