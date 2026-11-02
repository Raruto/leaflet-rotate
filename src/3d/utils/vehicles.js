// Built-in vehicles for the 'traffic' type. Models are [ring of [x, z], bottom, top, rgb, topRing?] convex prisms in metres;
// forward is -z, right is +x. `topRing` (same length as `ring`) tapers the prism; rgb components above 1 are self-lit lamps.
const paints = [[0.86, 0.86, 0.88], [0.1, 0.1, 0.12], [0.5, 0.53, 0.57], [0.65, 0.1, 0.08], [0.12, 0.25, 0.55], [0.85, 0.7, 0.15]];
const box = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const mirror = (x0, x1, z0, z1, ...rest) => [[box(x0, x1, z0, z1), ...rest], [box(-x1, -x0, z0, z1), ...rest]];
const glass = [0.12, 0.15, 0.18], tyre = [0.05, 0.05, 0.05];
const headlight = [1.9, 1.85, 1.7], taillight = [1.7, 0.06, 0.05];
const car = i => {
  const paint = paints[i % paints.length];
  return [
    ...mirror(0.7, 0.92, -1.68, -1.02, 0, 0.64, tyre),
    ...mirror(0.7, 0.92, 1.02, 1.68, 0, 0.64, tyre),
    [[[-0.9, -1.95], [-0.72, -2.25], [0.72, -2.25], [0.9, -1.95], [0.9, 2.05], [0.76, 2.25], [-0.76, 2.25], [-0.9, 2.05]],
      0.28, 0.82, paint],
    // Greenhouse: the windscreen leans back, the rear window less.
    [box(-0.84, 0.84, -0.75, 1.6), 0.82, 1.38, glass, box(-0.7, 0.7, -0.05, 1.3)],
    [box(-0.71, 0.71, -0.06, 1.31), 1.38, 1.46, paint],
    ...mirror(0.38, 0.8, -2.3, -2.16, 0.56, 0.76, headlight),
    [box(-0.78, 0.78, 2.16, 2.3), 0.6, 0.76, taillight],
  ];
};
// Panoramic river cruiser, about 60 × 11 m: glass saloon, open upper deck with benches, wheelhouse forward.
const white = [0.92, 0.93, 0.92], hull = [[-5.5, 30], [5.5, 30], [5.5, -20], [4, -26], [1.5, -30], [-1.5, -30], [-4, -26], [-5.5, -20]];
const boat = () => [
  [hull, 0, 0.8, [0.1, 0.16, 0.26]],
  [hull, 0.8, 1.4, white],
  [box(-5, 5, -18, 26), 1.4, 3.7, glass, box(-4.6, 4.6, -17.4, 25.6)],
  ...mirror(4.64, 4.74, -17, 25, 3.25, 3.45, [1.6, 1.25, 0.8]),
  [box(-4.8, 4.8, -17.8, 25.8), 3.7, 3.9, white],
  ...Array.from({ length: 12 }, (_, i) => mirror(0.5, 3.8, -12 + i * 3, -11.3 + i * 3, 3.9, 4.4, [0.62, 0.1, 0.1])).flat(),
  ...mirror(4.65, 4.8, -13.6, 25.8, 3.9, 4.8, white),
  [box(-4.8, 4.8, 25.65, 25.8), 3.9, 4.8, white],
  [box(-2.2, 2.2, -17.6, -14), 3.9, 4.7, white],
  [box(-2.2, 2.2, -17.6, -14), 4.7, 5.5, glass],
  [box(-2.5, 2.5, -18, -13.6), 5.5, 5.7, white],
  [box(-2.45, -2.2, -16.2, -15.8), 5, 5.3, [2, 0.15, 0.1]],
  [box(2.2, 2.45, -16.2, -15.8), 5, 5.3, [0.1, 2, 0.4]],
  [box(-0.1, 0.1, -15.9, -15.7), 5.7, 6.6, white],
  [box(-0.15, 0.15, -15.95, -15.65), 6.6, 6.8, [2, 2, 1.9]],
];

export const build = parts => {
  const position = [], normal = [], color = [];
  const triangle = (a, b, c, tint) => {
    const u = b.map((v, i) => v - a[i]), v = c.map((w, i) => w - a[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], length = Math.hypot(...n);
    for (const point of [a, b, c]) { position.push(...point); normal.push(...n.map(w => w / length)); color.push(...tint); }
  };
  for (const [ring, bottom, top, tint, topRing = ring] of parts) {
    const low = ring.map(([x, z]) => [x, bottom, z]), high = topRing.map(([x, z]) => [x, top, z]);
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      triangle(low[i], low[j], high[j], tint); triangle(low[i], high[j], high[i], tint);
    }
    for (let i = 1; i < ring.length - 1; i++) {
      triangle(high[0], high[i], high[i + 1], tint); triangle(low[0], low[i + 1], low[i], tint);
    }
  }
  return { position, normal, color };
};

/**
 * `side`: default offset (metres) to the right of the lane centreline. `model(i)` gives the prisms of the i-th vehicle.
 * `lights`: night point lights in model space (see the night lighting grid), e.g. the pool cast by the headlights.
 */
export const vehicles = {
  car: { side: 1.8, model: car, lights: [{ position: [0, 1.2, -6], radius: 10, color: [1, 0.94, 0.82], flux: 800 }] },
  boat: { side: 0, model: boat, lights: [{ position: [0, 8, 4], radius: 30, color: [1, 0.8, 0.55], flux: 20000 }] },
};
