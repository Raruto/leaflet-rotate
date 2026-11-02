import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lampStyle } from '../examples/night-lights.js';

test('streetlight dimensions and colour use recorded height, flux and Kelvin with explicit documented fallbacks', () => {
  const lamp = (properties = {}) => ({ properties });
  const recorded = lampStyle(lamp({ support_hauteur: '7.0', lampe_flux: '13165.0', lampe_temperature_couleur: '2700.0' }));
  assert.equal(recorded.top, 7);
  assert.ok(Math.abs(recorded.lightRadius - 10.5 * Math.sqrt(13165 / 10000)) < 1e-10);
  assert.equal(recorded.color.r, 1);
  assert.equal(recorded.color.b, 135 / 255);
  const defaults = lampStyle(lamp());
  assert.equal(defaults.top, 6);
  assert.deepEqual(lampStyle(lamp({ support_hauteur: 'None', lampe_flux: '-10', lampe_temperature_couleur: '' })), defaults);
  const sodium = lampStyle(lamp({ lampe_famille: 'Lampe sodium haute pression' }));
  assert.ok(sodium.color.b < defaults.color.b);
  const white = lampStyle(lamp({ lampe_temperature_couleur: '6500' }));
  assert.ok(white.color.b > white.color.r);
  assert.equal(lampStyle(lamp({ support_hauteur: 40, lampe_flux: 500000 })).lightRadius, 22);
  assert.equal(lampStyle(lamp({ support_hauteur: 1, lampe_flux: 10 })).lightRadius, 6);
});

test('underground lamps are excluded before any fixture or light is created', () => {
  for (const properties of [
    { lib_ouvrag: 'Galerie' }, { lib_ouvrag: 'Eclairage Poste et Galeries de service' },
    { voie_libelle: 'CHARLES DE GAULLE (souterrain pieton)' },
    { voie_libelle: 'TUNNEL DES TUILERIES' }, { voie_libelle: 'Local sous-sol' },
    { support_hauteur: '-2.0' },
  ]) assert.equal(lampStyle({ properties }), null, JSON.stringify(properties));
  assert.ok(lampStyle({ properties: { lib_ouvrag: 'Sol', voie_libelle: 'RUE DE RIVOLI' } }));
  for (const lib_ouvrag of ['Candélabre', 'Mât', 'Porte LAC RATP']) {
    assert.equal(lampStyle({ properties: { lib_ouvrag } }).poleRadius, 0.12);
  }
  for (const lib_ouvrag of ['Console', 'Applique', 'Projecteur', 'Sol']) {
    assert.equal(lampStyle({ properties: { lib_ouvrag } }).poleRadius, 0);
  }
});
