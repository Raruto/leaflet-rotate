// Built-in vehicles for the 'traffic' type. Models are [ring of [x, z], bottom, top, rgb] prisms in metres; forward is -z, right is +x.
const paints = [[0.86, 0.86, 0.88], [0.1, 0.1, 0.12], [0.5, 0.53, 0.57], [0.65, 0.1, 0.08], [0.12, 0.25, 0.55], [0.85, 0.7, 0.15]];
const car = i => [[[[-0.9, -2.2], [0.9, -2.2], [0.9, 2.2], [-0.9, 2.2]], 0, 1.5, paints[i % paints.length]]];
const boat = () => [
  [[[-4.5, 16], [4.5, 16], [4.5, -12], [2, -18], [-2, -18], [-4.5, -12]], 0.1, 1.2, [0.83, 0.87, 0.89]],
  [[[-3.4, 10], [3.4, 10], [3.4, -10], [-3.4, -10]], 1.2, 2.5, [0.16, 0.35, 0.43]],
  [[[-3.7, 11], [3.7, 11], [3.7, -11], [-3.7, -11]], 2.5, 2.7, [0.93, 0.94, 0.90]],
  ...[-3.6, 3.6].map(x => [[[x - 0.15, 13], [x + 0.15, 13], [x + 0.15, -12], [x - 0.15, -12]], 1.2, 1.8, [0.75, 0.15, 0.12]]),
];

export const build = parts => {
  const position = [], normal = [], color = [];
  const triangle = (a, b, c, tint) => {
    const u = b.map((v, i) => v - a[i]), v = c.map((w, i) => w - a[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], length = Math.hypot(...n);
    for (const point of [a, b, c]) { position.push(...point); normal.push(...n.map(w => w / length)); color.push(...tint); }
  };
  for (const [ring, bottom, top, tint] of parts) for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
    const a = [x0, bottom, z0], b = [x1, bottom, z1], c = [x1, top, z1], d = [x0, top, z0];
    triangle(a, b, c, tint); triangle(a, c, d, tint);
    triangle([0, top, 0], d, c, tint); triangle([0, bottom, 0], b, a, tint);
  }
  return { position, normal, color };
};

/** `side`: default offset (metres) to the right of the lane centreline. `model(i)` gives the prisms of the i-th vehicle. */
export const vehicles = {
  car: { side: 1.8, model: car },
  boat: { side: 0, model: boat },
};
