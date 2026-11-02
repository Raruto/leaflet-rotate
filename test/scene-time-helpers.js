import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../examples/leaflet-rotate-3d-layer.html', import.meta.url), 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
const initialization = script?.indexOf('const map = new L.Map');
if (!script || initialization < 0) throw new Error('Scene helpers not found in the 3D example');

const context = {};
runInNewContext(`${script.slice(0, initialization)}
globalThis.sceneTime = { atmosphere, moonPosition, solarPosition, scheduledCruises, cruisePosition, cruiseRoute, cruiseDistance };`, context);

const helpers = context.sceneTime;
const clone = value => JSON.parse(JSON.stringify(value));
const call = name => (...args) => clone(helpers[name](...args));

export const atmosphere = call('atmosphere');
export const moonPosition = call('moonPosition');
export const solarPosition = call('solarPosition');
export const scheduledCruises = call('scheduledCruises');
export const cruisePosition = call('cruisePosition');
export const cruiseRoute = clone(helpers.cruiseRoute);
export const cruiseDistance = helpers.cruiseDistance;
